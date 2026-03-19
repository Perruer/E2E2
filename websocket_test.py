#!/usr/bin/env python3
"""
WebSocket Testing for XAMTON P2P Signaling
Tests real-time message delivery and P2P functionality
"""

import asyncio
import websockets
import json
import requests
import base64
from datetime import datetime

# WebSocket URL for testing (using external URL)
WS_URL = "wss://censorship-resistant.preview.emergentagent.com/api/ws"
BACKEND_URL = "https://censorship-resistant.preview.emergentagent.com/api"

class WebSocketTester:
    def __init__(self):
        self.test_results = {
            'passed': 0,
            'failed': 0,
            'errors': []
        }

    def log_test(self, test_name, passed, message=""):
        """Log test result"""
        status = "✅ PASS" if passed else "❌ FAIL"
        print(f"{status} {test_name}")
        if message:
            print(f"    {message}")
        
        if passed:
            self.test_results['passed'] += 1
        else:
            self.test_results['failed'] += 1
            self.test_results['errors'].append(f"{test_name}: {message}")

    async def test_websocket_connection(self):
        """Test WebSocket connection and basic communication"""
        try:
            user_id = "xamt:ws_test_user"
            
            # Register user first
            requests.post(f"{BACKEND_URL}/users/register", json={
                "user_id": user_id,
                "display_name": "WebSocket Test User",
                "identity_key": base64.b64encode(b"ws_test_identity_key").decode()
            })
            
            # Test WebSocket connection
            uri = f"{WS_URL}/{user_id}"
            async with websockets.connect(uri) as websocket:
                # Send ping
                await websocket.send(json.dumps({"type": "ping"}))
                
                # Wait for pong response
                response = await asyncio.wait_for(websocket.recv(), timeout=5.0)
                data = json.loads(response)
                
                if data.get("type") == "pong":
                    self.log_test("WebSocket Connection & Ping/Pong", True, "Connection established and ping/pong working")
                else:
                    self.log_test("WebSocket Connection & Ping/Pong", False, f"Unexpected response: {data}")
        
        except Exception as e:
            self.log_test("WebSocket Connection & Ping/Pong", False, f"Exception: {str(e)}")

    async def test_peer_discovery_ws(self):
        """Test peer discovery through WebSocket"""
        try:
            user_id = "xamt:peer_discovery_test"
            
            # Register user
            requests.post(f"{BACKEND_URL}/users/register", json={
                "user_id": user_id,
                "display_name": "Peer Discovery User",
                "identity_key": base64.b64encode(b"peer_discovery_key").decode()
            })
            
            # Connect via WebSocket
            uri = f"{WS_URL}/{user_id}"
            async with websockets.connect(uri) as websocket:
                # Request peers list
                await websocket.send(json.dumps({"type": "get_peers"}))
                
                # Wait for peers response
                response = await asyncio.wait_for(websocket.recv(), timeout=5.0)
                data = json.loads(response)
                
                if data.get("type") == "peers_list":
                    peers = data.get("peers", [])
                    count = data.get("count", 0)
                    self.log_test("WebSocket Peer Discovery", True, f"Retrieved {count} online peers")
                else:
                    self.log_test("WebSocket Peer Discovery", False, f"Unexpected response: {data}")
        
        except Exception as e:
            self.log_test("WebSocket Peer Discovery", False, f"Exception: {str(e)}")

    async def test_real_time_messaging(self):
        """Test real-time message delivery between two users"""
        try:
            user1_id = "xamt:sender_realtime"
            user2_id = "xamt:receiver_realtime"
            
            # Register both users
            for user_id, display_name in [(user1_id, "Sender"), (user2_id, "Receiver")]:
                requests.post(f"{BACKEND_URL}/users/register", json={
                    "user_id": user_id,
                    "display_name": display_name,
                    "identity_key": base64.b64encode(f"{user_id}_key".encode()).decode()
                })
            
            # Connect both users via WebSocket
            uri1 = f"{WS_URL}/{user1_id}"
            uri2 = f"{WS_URL}/{user2_id}"
            
            async with websockets.connect(uri1) as ws1, websockets.connect(uri2) as ws2:
                # Send message from user1 to user2
                test_message = {
                    "type": "message",
                    "recipient_id": user2_id,
                    "payload": base64.b64encode(b"Hello from WebSocket real-time test!").decode()
                }
                
                await ws1.send(json.dumps(test_message))
                
                # Wait for acknowledgment from sender
                ack_response = await asyncio.wait_for(ws1.recv(), timeout=5.0)
                ack_data = json.loads(ack_response)
                
                # Wait for message delivery to receiver
                msg_response = await asyncio.wait_for(ws2.recv(), timeout=5.0)
                msg_data = json.loads(msg_response)
                
                # Validate responses
                if (ack_data.get("type") == "message_ack" and 
                    msg_data.get("type") == "new_message" and
                    ack_data.get("delivered")):
                    self.log_test("Real-time Message Delivery", True, 
                                "Message sent and delivered in real-time")
                else:
                    self.log_test("Real-time Message Delivery", False, 
                                f"Message delivery failed. ACK: {ack_data}, MSG: {msg_data}")
        
        except Exception as e:
            self.log_test("Real-time Message Delivery", False, f"Exception: {str(e)}")

    async def test_typing_indicator(self):
        """Test typing indicator functionality"""
        try:
            user1_id = "xamt:typer"
            user2_id = "xamt:listener"
            
            # Register both users
            for user_id, display_name in [(user1_id, "Typer"), (user2_id, "Listener")]:
                requests.post(f"{BACKEND_URL}/users/register", json={
                    "user_id": user_id,
                    "display_name": display_name,
                    "identity_key": base64.b64encode(f"{user_id}_key".encode()).decode()
                })
            
            # Connect both users via WebSocket
            uri1 = f"{WS_URL}/{user1_id}"
            uri2 = f"{WS_URL}/{user2_id}"
            
            async with websockets.connect(uri1) as ws1, websockets.connect(uri2) as ws2:
                # Send typing indicator from user1 to user2
                typing_msg = {
                    "type": "typing",
                    "recipient_id": user2_id
                }
                
                await ws1.send(json.dumps(typing_msg))
                
                # Wait for typing indicator to be delivered to receiver
                response = await asyncio.wait_for(ws2.recv(), timeout=5.0)
                data = json.loads(response)
                
                if (data.get("type") == "typing" and 
                    data.get("sender_id") == user1_id):
                    self.log_test("Typing Indicator", True, "Typing indicator delivered correctly")
                else:
                    self.log_test("Typing Indicator", False, f"Unexpected response: {data}")
        
        except Exception as e:
            self.log_test("Typing Indicator", False, f"Exception: {str(e)}")

    async def run_all_tests(self):
        """Run all WebSocket tests"""
        print("🌐 Starting XAMTON WebSocket & P2P Tests")
        print("=" * 50)
        
        await self.test_websocket_connection()
        await self.test_peer_discovery_ws()
        await self.test_real_time_messaging()
        await self.test_typing_indicator()
        
        print("\n" + "=" * 50)
        print("📊 WebSocket Test Summary:")
        print(f"✅ Passed: {self.test_results['passed']}")
        print(f"❌ Failed: {self.test_results['failed']}")
        
        if self.test_results['errors']:
            print("\n🔍 Failed Tests Details:")
            for error in self.test_results['errors']:
                print(f"  • {error}")
        
        return self.test_results['failed'] == 0

if __name__ == "__main__":
    async def main():
        tester = WebSocketTester()
        success = await tester.run_all_tests()
        
        if not success:
            print(f"\n❌ Some WebSocket tests failed.")
            exit(1)
        else:
            print(f"\n🎉 All WebSocket tests passed! XAMTON P2P signaling is working correctly.")
            exit(0)
    
    asyncio.run(main())