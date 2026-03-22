package com.xamton.messenger

import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.content.Context
import com.facebook.react.bridge.*
import com.facebook.react.module.annotations.ReactModule

@ReactModule(name = XAMTONBluetoothModule.NAME)
class XAMTONBluetoothModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val NAME = "XAMTONBluetooth"
    }

    private var originalName: String? = null

    override fun getName() = NAME

    /**
     * Меняет имя Bluetooth адаптера чтобы другие XAMTON устройства нас нашли
     * Формат: XAMT:{userId}:{displayName}
     */
    @ReactMethod
    fun setBluetoothName(name: String, promise: Promise) {
        try {
            val bluetoothManager = reactApplicationContext
                .getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
            val adapter = bluetoothManager?.adapter

            if (adapter == null) {
                promise.reject("BT_ERROR", "Bluetooth adapter not available")
                return
            }

            // Сохраняем оригинальное имя
            if (originalName == null) {
                originalName = adapter.name
            }

            val result = adapter.setName(name)
            if (result) {
                promise.resolve(true)
            } else {
                promise.reject("BT_ERROR", "Failed to set Bluetooth name")
            }
        } catch (e: Exception) {
            promise.reject("BT_ERROR", e.message)
        }
    }

    /**
     * Восстанавливает оригинальное имя Bluetooth
     */
    @ReactMethod
    fun resetBluetoothName(promise: Promise) {
        try {
            val bluetoothManager = reactApplicationContext
                .getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
            val adapter = bluetoothManager?.adapter

            if (adapter != null && originalName != null) {
                adapter.setName(originalName)
            }
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("BT_ERROR", e.message)
        }
    }

    /**
     * Получить текущее имя Bluetooth адаптера
     */
    @ReactMethod
    fun getBluetoothName(promise: Promise) {
        try {
            val bluetoothManager = reactApplicationContext
                .getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
            val adapter = bluetoothManager?.adapter
            promise.resolve(adapter?.name ?: "")
        } catch (e: Exception) {
            promise.reject("BT_ERROR", e.message)
        }
    }
}
