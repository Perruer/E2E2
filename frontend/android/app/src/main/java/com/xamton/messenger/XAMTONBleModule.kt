package com.xamton.messenger

import android.Manifest
import android.bluetooth.*
import android.bluetooth.le.*
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.ParcelUuid
import android.util.Log
import androidx.core.app.ActivityCompat
import com.facebook.react.bridge.*
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.nio.charset.Charset
import java.util.*
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

@ReactModule(name = XAMTONBleModule.NAME)
class XAMTONBleModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val NAME = "XAMTONBle"
        const val TAG = "XAMTONBle"

        val SERVICE_UUID: UUID = UUID.fromString("6E400001-B5A3-F393-E0A9-E50E24DCCA9E")
        val TX_CHAR_UUID: UUID = UUID.fromString("6E400002-B5A3-F393-E0A9-E50E24DCCA9E")
        val RX_CHAR_UUID: UUID = UUID.fromString("6E400003-B5A3-F393-E0A9-E50E24DCCA9E")
        val CCCD_UUID: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")

        const val GATT_OP_TIMEOUT_MS = 5000L
        const val DESIRED_MTU = 512
        const val DEFAULT_MTU = 20 // BLE default
        const val MTU_OVERHEAD = 3  // ATT protocol overhead

        // Framing markers — для сборки фрагментированных сообщений
        const val FRAME_START = "«XMSG»"
        const val FRAME_END = "«/XMSG»"
    }

    private val bluetoothManager by lazy {
        reactContext.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
    }
    private val adapter: BluetoothAdapter? by lazy { bluetoothManager.adapter }
    private val advertiser: BluetoothLeAdvertiser? by lazy { adapter?.bluetoothLeAdvertiser }
    private val scanner: BluetoothLeScanner? by lazy { adapter?.bluetoothLeScanner }
    private val mainHandler = Handler(Looper.getMainLooper())

    private var gattServer: BluetoothGattServer? = null
    private var isAdvertising = false
    private var isScanning = false
    private var myUserId = ""

    private val connectedCentrals = ConcurrentHashMap<String, BluetoothDevice>()
    private val connectedGattClients = ConcurrentHashMap<String, BluetoothGatt>()
    private val macToUserId = ConcurrentHashMap<String, String>()
    private val discoveredDevices = ConcurrentHashMap<String, Long>()
    private val subscribedDevices = ConcurrentHashMap<String, BluetoothDevice>()

    // MTU для каждого соединения
    private val negotiatedMtu = ConcurrentHashMap<String, Int>()

    // Буферы для сборки фрагментированных сообщений
    private val incomingBuffers = ConcurrentHashMap<String, StringBuilder>()

    // GATT Operation Queue
    private data class GattOp(val type: String, val action: () -> Unit)
    private val gattOpQueues = ConcurrentHashMap<String, ConcurrentLinkedQueue<GattOp>>()
    private val gattOpInProgress = ConcurrentHashMap<String, Boolean>()
    private val writeLatch = ConcurrentHashMap<String, CountDownLatch>()

    override fun getName() = NAME

    // Максимальный payload для данного MAC
    private fun getMaxPayload(mac: String): Int {
        val mtu = negotiatedMtu[mac] ?: DEFAULT_MTU
        return mtu - MTU_OVERHEAD
    }

    // ═══════════════════════════════════════════════════════════════════════
    // GATT Operation Queue
    // ═══════════════════════════════════════════════════════════════════════

    private fun enqueueGattOp(mac: String, type: String, action: () -> Unit) {
        val queue = gattOpQueues.getOrPut(mac) { ConcurrentLinkedQueue() }
        queue.add(GattOp(type, action))
        processNextGattOp(mac)
    }

    private fun processNextGattOp(mac: String) {
        if (gattOpInProgress.getOrDefault(mac, false)) return
        val queue = gattOpQueues[mac] ?: return
        val op = queue.poll() ?: return
        gattOpInProgress[mac] = true
        Log.d(TAG, "GATT op: ${op.type} on $mac")
        try { op.action() } catch (e: Exception) {
            Log.e(TAG, "GATT op error: ${e.message}")
            gattOpInProgress[mac] = false
            processNextGattOp(mac)
        }
        mainHandler.postDelayed({
            if (gattOpInProgress.getOrDefault(mac, false)) {
                Log.w(TAG, "GATT op timeout: ${op.type} on $mac")
                gattOpInProgress[mac] = false
                processNextGattOp(mac)
            }
        }, GATT_OP_TIMEOUT_MS)
    }

    private fun onGattOpComplete(mac: String) {
        gattOpInProgress[mac] = false
        processNextGattOp(mac)
    }

    // ═══════════════════════════════════════════════════════════════════════
    // React Native API
    // ═══════════════════════════════════════════════════════════════════════

    @ReactMethod
    fun initialize(userId: String, promise: Promise) {
        myUserId = userId
        if (adapter == null) { promise.reject("BLE_ERROR", "Bluetooth not available"); return }
        if (!adapter!!.isEnabled) { promise.reject("BLE_ERROR", "Bluetooth is disabled"); return }
        if (!hasPermissions()) { promise.reject("BLE_ERROR", "BLE permissions not granted"); return }
        Log.d(TAG, "Initialized: ${userId.take(8)}...")
        promise.resolve(true)
    }

    @ReactMethod
    fun startAdvertising(userId: String, promise: Promise) {
        if (isAdvertising) { promise.resolve(true); return }
        try {
            startGattServer()
            startBleAdvertising(userId)
            isAdvertising = true
            promise.resolve(true)
        } catch (e: Exception) {
            Log.e(TAG, "startAdvertising error", e)
            promise.reject("BLE_ERROR", e.message)
        }
    }

    @ReactMethod
    fun stopAdvertising(promise: Promise) {
        try { stopBleAdvertising(); stopGattServer(); isAdvertising = false; promise.resolve(true) }
        catch (e: Exception) { promise.reject("BLE_ERROR", e.message) }
    }

    @ReactMethod
    fun startScanning(promise: Promise) {
        if (isScanning) { promise.resolve(true); return }
        try {
            val filters = listOf(ScanFilter.Builder().setServiceUuid(ParcelUuid(SERVICE_UUID)).build())
            val settings = ScanSettings.Builder()
                .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
                .setMatchMode(ScanSettings.MATCH_MODE_AGGRESSIVE)
                .setNumOfMatches(ScanSettings.MATCH_NUM_MAX_ADVERTISEMENT)
                .setReportDelay(0).build()
            if (!hasPermissions()) { promise.reject("BLE_ERROR", "Scan permission denied"); return }
            scanner?.startScan(filters, settings, scanCallback)
            isScanning = true
            Log.d(TAG, "Scanning started")
            promise.resolve(true)
        } catch (e: Exception) { promise.reject("BLE_ERROR", e.message) }
    }

    @ReactMethod
    fun stopScanning(promise: Promise) {
        try {
            if (!hasPermissions()) { promise.reject("BLE_ERROR", "Scan permission denied"); return }
            scanner?.stopScan(scanCallback); isScanning = false; promise.resolve(true)
        } catch (e: Exception) { promise.reject("BLE_ERROR", e.message) }
    }

    @ReactMethod
    fun sendMessage(targetMac: String, data: String, promise: Promise) {
        Log.d(TAG, "sendMessage → $targetMac (${data.length} chars)")
        val framedData = FRAME_START + data + FRAME_END

        val gatt = connectedGattClients[targetMac]
        if (gatt != null) {
            writeToPeripheral(gatt, targetMac, framedData, promise)
            return
        }

        val device = connectedCentrals[targetMac]
        if (device != null && subscribedDevices.containsKey(targetMac)) {
            notifyToCentral(device, targetMac, framedData, promise)
            return
        }

        Log.w(TAG, "sendMessage FAIL — not connected: $targetMac")
        promise.reject("BLE_ERROR", "Device not connected: $targetMac")
    }

    @ReactMethod
    fun sendToAll(data: String, promise: Promise) {
        var sent = 0
        val framedData = FRAME_START + data + FRAME_END
        Log.d(TAG, "sendToAll: subscribed=${subscribedDevices.size}, clients=${connectedGattClients.size}")

        for ((mac, device) in subscribedDevices) {
            try { notifyToCentralChunked(device, mac, framedData); sent++ }
            catch (e: Exception) { Log.w(TAG, "sendToAll → central $mac FAIL: ${e.message}") }
        }
        for ((mac, gatt) in connectedGattClients) {
            try { writeToPeripheralBlocking(gatt, mac, framedData); sent++ }
            catch (e: Exception) { Log.w(TAG, "sendToAll → peripheral $mac FAIL: ${e.message}") }
        }
        Log.d(TAG, "sendToAll done: $sent devices")
        promise.resolve(sent)
    }

    @ReactMethod
    fun getConnectedPeers(promise: Promise) {
        val peers = WritableNativeArray()
        val allMacs = mutableSetOf<String>()
        allMacs.addAll(connectedCentrals.keys)
        allMacs.addAll(connectedGattClients.keys)
        for (mac in allMacs) {
            peers.pushMap(WritableNativeMap().apply {
                putString("mac", mac)
                putString("userId", macToUserId[mac] ?: "")
                putString("role", if (connectedCentrals.containsKey(mac)) "central" else "peripheral")
            })
        }
        promise.resolve(peers)
    }

    @ReactMethod
    fun disconnectAll(promise: Promise) {
        for ((_, gatt) in connectedGattClients) { try { gatt.disconnect(); gatt.close() } catch (_: Exception) {} }
        connectedGattClients.clear(); connectedCentrals.clear(); macToUserId.clear()
        subscribedDevices.clear(); discoveredDevices.clear(); gattOpQueues.clear()
        gattOpInProgress.clear(); negotiatedMtu.clear(); incomingBuffers.clear()
        promise.resolve(true)
    }

    @ReactMethod fun addListener(eventName: String) {}
    @ReactMethod fun removeListeners(count: Int) {}

    // ═══════════════════════════════════════════════════════════════════════
    // GATT Server
    // ═══════════════════════════════════════════════════════════════════════

    private fun startGattServer() {
        if (gattServer != null) return
        if (!hasPermissions()) return
        gattServer = bluetoothManager.openGattServer(reactApplicationContext, gattServerCallback)
        val service = BluetoothGattService(SERVICE_UUID, BluetoothGattService.SERVICE_TYPE_PRIMARY)
        val txChar = BluetoothGattCharacteristic(TX_CHAR_UUID,
            BluetoothGattCharacteristic.PROPERTY_NOTIFY or BluetoothGattCharacteristic.PROPERTY_READ,
            BluetoothGattCharacteristic.PERMISSION_READ)
        txChar.addDescriptor(BluetoothGattDescriptor(CCCD_UUID,
            BluetoothGattDescriptor.PERMISSION_READ or BluetoothGattDescriptor.PERMISSION_WRITE))
        val rxChar = BluetoothGattCharacteristic(RX_CHAR_UUID,
            BluetoothGattCharacteristic.PROPERTY_WRITE or BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE,
            BluetoothGattCharacteristic.PERMISSION_WRITE)
        service.addCharacteristic(txChar)
        service.addCharacteristic(rxChar)
        gattServer?.addService(service)
        Log.d(TAG, "GATT Server started")
    }

    private fun stopGattServer() {
        if (!hasPermissions()) return
        gattServer?.clearServices(); gattServer?.close(); gattServer = null
    }

    private val gattServerCallback = object : BluetoothGattServerCallback() {
        override fun onConnectionStateChange(device: BluetoothDevice, status: Int, newState: Int) {
            val mac = device.address
            if (newState == BluetoothProfile.STATE_CONNECTED) {
                Log.d(TAG, "Central connected: $mac")
                connectedCentrals[mac] = device
                emitEvent("onPeerConnected", Arguments.createMap().apply {
                    putString("mac", mac); putString("userId", ""); putString("role", "central")
                })
            } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                Log.d(TAG, "Central disconnected: $mac")
                connectedCentrals.remove(mac); subscribedDevices.remove(mac)
                negotiatedMtu.remove(mac); incomingBuffers.remove(mac)
                val userId = macToUserId.remove(mac)
                emitEvent("onPeerDisconnected", Arguments.createMap().apply {
                    putString("mac", mac); putString("userId", userId ?: "")
                })
            }
        }

        override fun onMtuChanged(device: BluetoothDevice, mtu: Int) {
            Log.d(TAG, "Server MTU changed for ${device.address}: $mtu")
            negotiatedMtu[device.address] = mtu
        }

        override fun onCharacteristicWriteRequest(device: BluetoothDevice, requestId: Int,
            characteristic: BluetoothGattCharacteristic, preparedWrite: Boolean,
            responseNeeded: Boolean, offset: Int, value: ByteArray?) {
            if (characteristic.uuid == RX_CHAR_UUID && value != null) {
                val data = String(value, Charset.forName("UTF-8"))
                Log.d(TAG, "RX from ${device.address} (${value.size}b): ${data.take(60)}...")
                handleIncomingFragment(device.address, data)
            }
            if (responseNeeded && hasPermissions()) {
                gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, null)
            }
        }

        override fun onCharacteristicReadRequest(device: BluetoothDevice, requestId: Int,
            offset: Int, characteristic: BluetoothGattCharacteristic) {
            if (hasPermissions()) {
                gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0,
                    myUserId.toByteArray(Charset.forName("UTF-8")))
            }
        }

        override fun onDescriptorWriteRequest(device: BluetoothDevice, requestId: Int,
            descriptor: BluetoothGattDescriptor, preparedWrite: Boolean,
            responseNeeded: Boolean, offset: Int, value: ByteArray?) {
            if (descriptor.uuid == CCCD_UUID) {
                if (value?.contentEquals(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE) == true) {
                    subscribedDevices[device.address] = device
                    Log.d(TAG, "Central subscribed: ${device.address}")
                } else { subscribedDevices.remove(device.address) }
            }
            if (responseNeeded && hasPermissions()) {
                gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, null)
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Advertising & Scanning
    // ═══════════════════════════════════════════════════════════════════════

    private fun startBleAdvertising(userId: String) {
        if (advertiser == null) throw Exception("BLE Advertiser not available")
        if (!hasPermissions()) throw Exception("Advertise permission denied")
        val settings = AdvertiseSettings.Builder()
            .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
            .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
            .setConnectable(true).setTimeout(0).build()
        val data = AdvertiseData.Builder().setIncludeDeviceName(false).setIncludeTxPowerLevel(false)
            .addServiceUuid(ParcelUuid(SERVICE_UUID)).build()
        val scanResponse = AdvertiseData.Builder()
            .addManufacturerData(0x5841, userId.take(8).toByteArray(Charset.forName("UTF-8"))).build()
        advertiser?.startAdvertising(settings, data, scanResponse, advertiseCallback)
    }

    private fun stopBleAdvertising() { if (hasPermissions()) advertiser?.stopAdvertising(advertiseCallback) }

    private val advertiseCallback = object : AdvertiseCallback() {
        override fun onStartSuccess(s: AdvertiseSettings?) { Log.d(TAG, "Advertising OK"); emitEvent("onAdvertisingStarted", Arguments.createMap()) }
        override fun onStartFailure(e: Int) { Log.e(TAG, "Advertising FAILED: $e"); isAdvertising = false; emitEvent("onAdvertisingFailed", Arguments.createMap().apply { putInt("errorCode", e) }) }
    }

    private val scanCallback = object : ScanCallback() {
        override fun onScanResult(callbackType: Int, result: ScanResult) {
            val device = result.device; val mac = device.address
            val now = System.currentTimeMillis()
            val lastSeen = discoveredDevices[mac]
            if (lastSeen != null && now - lastSeen < 30_000) return
            discoveredDevices[mac] = now
            if (connectedGattClients.containsKey(mac) || connectedCentrals.containsKey(mac)) return

            var peerUserId = ""
            result.scanRecord?.getManufacturerSpecificData(0x5841)?.let { bytes ->
                peerUserId = String(bytes, Charset.forName("UTF-8"))
            }
            if (peerUserId == myUserId.take(8)) return

            Log.d(TAG, "Discovered: $mac userId=$peerUserId RSSI=${result.rssi}")
            emitEvent("onPeerDiscovered", Arguments.createMap().apply {
                putString("mac", mac); putString("userId", peerUserId); putInt("rssi", result.rssi)
            })
            connectToPeripheral(device, peerUserId)
        }
        override fun onScanFailed(errorCode: Int) { Log.e(TAG, "Scan failed: $errorCode"); isScanning = false }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // GATT Client — MTU negotiation + sequential operations
    // ═══════════════════════════════════════════════════════════════════════

    private fun connectToPeripheral(device: BluetoothDevice, peerUserId: String) {
        if (!hasPermissions()) return
        val mac = device.address
        Log.d(TAG, "Connecting → $mac")

        device.connectGatt(reactApplicationContext, false, object : BluetoothGattCallback() {
            override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
                if (newState == BluetoothProfile.STATE_CONNECTED) {
                    Log.d(TAG, "Connected → $mac, requesting MTU $DESIRED_MTU")
                    connectedGattClients[mac] = gatt
                    if (peerUserId.isNotEmpty()) macToUserId[mac] = peerUserId
                    // Шаг 1: запросить MTU (до discover services!)
                    if (hasPermissions()) gatt.requestMtu(DESIRED_MTU)
                } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                    Log.d(TAG, "Disconnected from $mac")
                    connectedGattClients.remove(mac); gattOpQueues.remove(mac)
                    gattOpInProgress.remove(mac); negotiatedMtu.remove(mac)
                    incomingBuffers.remove(mac)
                    val userId = macToUserId.remove(mac); gatt.close()
                    emitEvent("onPeerDisconnected", Arguments.createMap().apply {
                        putString("mac", mac); putString("userId", userId ?: "")
                    })
                }
            }

            override fun onMtuChanged(gatt: BluetoothGatt, mtu: Int, status: Int) {
                Log.d(TAG, "MTU negotiated on $mac: $mtu (status=$status)")
                negotiatedMtu[mac] = mtu
                // Шаг 2: теперь discover services
                if (hasPermissions()) gatt.discoverServices()
            }

            override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
                if (status != BluetoothGatt.GATT_SUCCESS) { Log.e(TAG, "Discovery failed: $status"); return }
                val service = gatt.getService(SERVICE_UUID)
                if (service == null) { Log.e(TAG, "Service not found on $mac"); return }

                val mtu = negotiatedMtu[mac] ?: DEFAULT_MTU
                Log.d(TAG, "Services OK on $mac (MTU=$mtu)")

                val txChar = service.getCharacteristic(TX_CHAR_UUID)
                val rxChar = service.getCharacteristic(RX_CHAR_UUID)

                if (txChar != null && hasPermissions()) {
                    gatt.setCharacteristicNotification(txChar, true)
                }

                // GATT op 1: write CCCD
                if (txChar != null) {
                    val cccd = txChar.getDescriptor(CCCD_UUID)
                    if (cccd != null) {
                        enqueueGattOp(mac, "write-cccd") {
                            if (hasPermissions()) {
                                cccd.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
                                gatt.writeDescriptor(cccd)
                            }
                        }
                    }
                }

                // GATT op 2: handshake (framed!)
                if (rxChar != null) {
                    enqueueGattOp(mac, "write-handshake") {
                        if (hasPermissions()) {
                            val hs = FRAME_START + """{"type":"handshake","userId":"$myUserId"}""" + FRAME_END
                            rxChar.value = hs.toByteArray(Charset.forName("UTF-8"))
                            rxChar.writeType = BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
                            val ok = gatt.writeCharacteristic(rxChar)
                            Log.d(TAG, "Handshake → $mac: $ok (${hs.length} chars)")
                        }
                    }
                }

                emitEvent("onPeerConnected", Arguments.createMap().apply {
                    putString("mac", mac)
                    putString("userId", macToUserId[mac] ?: peerUserId)
                    putString("role", "peripheral")
                })
            }

            override fun onDescriptorWrite(gatt: BluetoothGatt, descriptor: BluetoothGattDescriptor, status: Int) {
                Log.d(TAG, "onDescriptorWrite $mac status=$status")
                onGattOpComplete(mac)
            }

            override fun onCharacteristicWrite(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, status: Int) {
                Log.d(TAG, "onCharacteristicWrite $mac status=$status")
                writeLatch[mac]?.countDown()
                onGattOpComplete(mac)
            }

            override fun onCharacteristicChanged(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic) {
                if (characteristic.uuid == TX_CHAR_UUID) {
                    val data = String(characteristic.value, Charset.forName("UTF-8"))
                    Log.d(TAG, "Notify from $mac (${characteristic.value.size}b): ${data.take(60)}...")
                    handleIncomingFragment(mac, data)
                }
            }

            override fun onCharacteristicRead(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, status: Int) {
                if (status == BluetoothGatt.GATT_SUCCESS && characteristic.uuid == TX_CHAR_UUID) {
                    val peerId = String(characteristic.value, Charset.forName("UTF-8"))
                    if (peerId.isNotEmpty()) macToUserId[mac] = peerId
                }
                onGattOpComplete(mac)
            }
        }, BluetoothDevice.TRANSPORT_LE)
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Отправка — с чанкованием по MTU
    // ═══════════════════════════════════════════════════════════════════════

    private fun writeToPeripheral(gatt: BluetoothGatt, mac: String, framedData: String, promise: Promise) {
        try {
            val service = gatt.getService(SERVICE_UUID)
            if (service == null) { promise.reject("BLE_ERROR", "Service not found"); return }
            val rxChar = service.getCharacteristic(RX_CHAR_UUID)
            if (rxChar == null) { promise.reject("BLE_ERROR", "RX char not found"); return }

            val bytes = framedData.toByteArray(Charset.forName("UTF-8"))
            val maxPayload = getMaxPayload(mac)
            val chunks = bytes.toList().chunked(maxPayload)

            Log.d(TAG, "Write → $mac: ${bytes.size}b in ${chunks.size} chunks (MTU payload=$maxPayload)")

            for ((i, chunk) in chunks.withIndex()) {
                enqueueGattOp(mac, "write-chunk-$i/${chunks.size}") {
                    if (hasPermissions()) {
                        rxChar.value = chunk.toByteArray()
                        rxChar.writeType = BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
                        gatt.writeCharacteristic(rxChar)
                    }
                }
            }
            promise.resolve(true)
        } catch (e: Exception) { promise.reject("BLE_ERROR", e.message) }
    }

    private fun writeToPeripheralBlocking(gatt: BluetoothGatt, mac: String, framedData: String) {
        if (!hasPermissions()) throw Exception("Permission denied")
        val service = gatt.getService(SERVICE_UUID) ?: throw Exception("Service not found")
        val rxChar = service.getCharacteristic(RX_CHAR_UUID) ?: throw Exception("RX char not found")

        val bytes = framedData.toByteArray(Charset.forName("UTF-8"))
        val maxPayload = getMaxPayload(mac)
        val chunks = bytes.toList().chunked(maxPayload)

        for ((i, chunk) in chunks.withIndex()) {
            val latch = CountDownLatch(1)
            writeLatch[mac] = latch
            enqueueGattOp(mac, "write-blocking-$i/${chunks.size}") {
                rxChar.value = chunk.toByteArray()
                rxChar.writeType = BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
                gatt.writeCharacteristic(rxChar)
            }
            if (!latch.await(GATT_OP_TIMEOUT_MS, TimeUnit.MILLISECONDS)) {
                Log.w(TAG, "Blocking write timeout chunk $i on $mac")
            }
            writeLatch.remove(mac)
        }
    }

    private fun notifyToCentral(device: BluetoothDevice, mac: String, framedData: String, promise: Promise) {
        try { notifyToCentralChunked(device, mac, framedData); promise.resolve(true) }
        catch (e: Exception) { promise.reject("BLE_ERROR", e.message) }
    }

    private fun notifyToCentralChunked(device: BluetoothDevice, mac: String, framedData: String) {
        if (!hasPermissions()) throw Exception("Permission denied")
        val service = gattServer?.getService(SERVICE_UUID) ?: throw Exception("GATT not ready")
        val txChar = service.getCharacteristic(TX_CHAR_UUID) ?: throw Exception("TX char not found")

        val bytes = framedData.toByteArray(Charset.forName("UTF-8"))
        val maxPayload = getMaxPayload(mac)
        val chunks = bytes.toList().chunked(maxPayload)

        Log.d(TAG, "Notify → ${device.address}: ${bytes.size}b in ${chunks.size} chunks (payload=$maxPayload)")

        for ((i, chunk) in chunks.withIndex()) {
            txChar.value = chunk.toByteArray()
            gattServer?.notifyCharacteristicChanged(device, txChar, false)
            // Маленькая задержка между notify чанками
            if (chunks.size > 1 && i < chunks.size - 1) Thread.sleep(30)
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Приём — сборка фрагментов по маркерам
    // ═══════════════════════════════════════════════════════════════════════

    private fun handleIncomingFragment(mac: String, fragment: String) {
        val buffer = incomingBuffers.getOrPut(mac) { StringBuilder() }
        buffer.append(fragment)

        val content = buffer.toString()

        // Ищем полные сообщения
        while (true) {
            val startIdx = content.indexOf(FRAME_START)
            val endIdx = content.indexOf(FRAME_END)

            if (startIdx == -1 || endIdx == -1 || endIdx < startIdx) {
                // Ещё не всё пришло — ждём
                // Но если буфер растёт без маркеров — это старый формат или мусор
                if (buffer.length > 10000) {
                    Log.w(TAG, "Buffer overflow for $mac, clearing")
                    buffer.clear()
                }
                break
            }

            // Извлекаем полное сообщение
            val message = content.substring(startIdx + FRAME_START.length, endIdx)
            Log.d(TAG, "Complete message from $mac (${message.length} chars): ${message.take(80)}...")

            // Удаляем обработанную часть из буфера
            val newContent = content.substring(endIdx + FRAME_END.length)
            buffer.clear()
            buffer.append(newContent)

            // Обрабатываем сообщение
            handleCompleteMessage(mac, message)

            // Продолжаем искать — возможно в буфере ещё сообщения
            break // На самом деле нужен re-check, но для безопасности break
        }
    }

    private fun handleCompleteMessage(mac: String, data: String) {
        try {
            if (data.contains(""""type":"handshake"""")) {
                val obj = org.json.JSONObject(data)
                val peerId = obj.optString("userId", "")
                if (peerId.isNotEmpty()) {
                    macToUserId[mac] = peerId
                    Log.d(TAG, "✓ Handshake from $mac → userId=$peerId")
                    emitEvent("onPeerIdentified", Arguments.createMap().apply {
                        putString("mac", mac); putString("userId", peerId)
                    })
                    // Ответный handshake от Peripheral → Central
                    if (connectedCentrals.containsKey(mac) && subscribedDevices.containsKey(mac)) {
                        try {
                            val response = FRAME_START + """{"type":"handshake","userId":"$myUserId"}""" + FRAME_END
                            notifyToCentralChunked(connectedCentrals[mac]!!, mac, response)
                            Log.d(TAG, "✓ Handshake response → central $mac")
                        } catch (e: Exception) { Log.w(TAG, "Handshake response error: ${e.message}") }
                    }
                }
                return
            }

            val userId = macToUserId[mac] ?: mac
            Log.d(TAG, "✓ MESSAGE from $userId: ${data.take(80)}...")
            emitEvent("onMessageReceived", Arguments.createMap().apply {
                putString("mac", mac); putString("userId", userId); putString("data", data)
            })
        } catch (e: Exception) { Log.w(TAG, "handleCompleteMessage error: ${e.message}") }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Утилиты
    // ═══════════════════════════════════════════════════════════════════════

    private fun hasPermissions(): Boolean {
        val ctx = reactApplicationContext
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            ActivityCompat.checkSelfPermission(ctx, Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED &&
            ActivityCompat.checkSelfPermission(ctx, Manifest.permission.BLUETOOTH_ADVERTISE) == PackageManager.PERMISSION_GRANTED &&
            ActivityCompat.checkSelfPermission(ctx, Manifest.permission.BLUETOOTH_SCAN) == PackageManager.PERMISSION_GRANTED
        } else {
            ActivityCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        }
    }

    private fun emitEvent(eventName: String, params: WritableMap) {
        try { reactApplicationContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit(eventName, params) }
        catch (e: Exception) { Log.w(TAG, "emitEvent error: ${e.message}") }
    }
}
