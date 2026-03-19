#!/usr/bin/env python3
"""
XAMTON Backend API Testing Script
Tests all backend endpoints with realistic data
"""

import requests
import json
import sys
import time
from datetime import datetime
import base64
import uuid

# Backend URL from environment
BACKEND_URL = "https://censorship-resistant.preview.emergentagent.com/api"

class XAMTONTester:
    def __init__(self):
        self.session = requests.Session()
        self.test_results = {
            'passed': 0,
            'failed': 0,
            'errors': []
        }
        
        # Test data - realistic XAMTON user data
        self.test_user_id = "xamt:alice_crypto"
        self.test_display_name = "Alice Cooper"
        self.test_identity_key = base64.b64encode(b"alice_identity_key_32bytes_test").decode()
        
        self.test_user2_id = "xamt:bob_secure" 
        self.test_user2_display_name = "Bob Marley"
        self.test_user2_identity_key = base64.b64encode(b"bob_identity_key_32bytes_test_xx").decode()

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

    def test_health_check(self):
        """Test /health endpoint"""
        try:
            response = self.session.get(f"{BACKEND_URL}/health", timeout=10)
            
            if response.status_code == 200:
                data = response.json()
                if data.get('status') == 'healthy':
                    self.log_test("Health Check", True, "Server is healthy")
                else:
                    self.log_test("Health Check", False, f"Unexpected response: {data}")
            else:
                self.log_test("Health Check", False, f"HTTP {response.status_code}: {response.text}")
        
        except Exception as e:
            self.log_test("Health Check", False, f"Exception: {str(e)}")

    def test_root_endpoint(self):
        """Test / root endpoint"""
        try:
            response = self.session.get(f"{BACKEND_URL}/", timeout=10)
            
            if response.status_code == 200:
                data = response.json()
                if data.get('name') == 'XAMTON Server':
                    self.log_test("Root Endpoint", True, f"Server version: {data.get('version')}")
                else:
                    self.log_test("Root Endpoint", False, f"Unexpected response: {data}")
            else:
                self.log_test("Root Endpoint", False, f"HTTP {response.status_code}: {response.text}")
        
        except Exception as e:
            self.log_test("Root Endpoint", False, f"Exception: {str(e)}")

    def test_user_registration(self):
        """Test POST /users/register"""
        try:
            payload = {
                "user_id": self.test_user_id,
                "display_name": self.test_display_name,
                "identity_key": self.test_identity_key
            }
            
            response = self.session.post(
                f"{BACKEND_URL}/users/register",
                json=payload,
                timeout=10
            )
            
            if response.status_code == 200:
                data = response.json()
                if data.get('success') and data.get('user_id') == self.test_user_id:
                    self.log_test("User Registration", True, f"User {self.test_user_id} registered")
                else:
                    self.log_test("User Registration", False, f"Unexpected response: {data}")
            else:
                self.log_test("User Registration", False, f"HTTP {response.status_code}: {response.text}")
        
        except Exception as e:
            self.log_test("User Registration", False, f"Exception: {str(e)}")

    def test_get_user(self):
        """Test GET /users/{user_id}"""
        try:
            response = self.session.get(
                f"{BACKEND_URL}/users/{self.test_user_id}",
                timeout=10
            )
            
            if response.status_code == 200:
                data = response.json()
                if (data.get('user_id') == self.test_user_id and 
                    data.get('display_name') == self.test_display_name and
                    data.get('identity_key') == self.test_identity_key):
                    self.log_test("Get User", True, f"Retrieved user {self.test_user_id}")
                else:
                    self.log_test("Get User", False, f"Data mismatch: {data}")
            elif response.status_code == 404:
                self.log_test("Get User", False, "User not found - registration may have failed")
            else:
                self.log_test("Get User", False, f"HTTP {response.status_code}: {response.text}")
        
        except Exception as e:
            self.log_test("Get User", False, f"Exception: {str(e)}")

    def test_prekey_bundle_upload(self):
        """Test POST /prekeys"""
        try:
            payload = {
                "user_id": self.test_user_id,
                "identity_key": self.test_identity_key,
                "signed_prekey_id": 1,
                "signed_prekey": base64.b64encode(b"signed_prekey_32bytes_test_alice").decode(),
                "signed_prekey_signature": base64.b64encode(b"signature_64bytes_test_alice_sig").decode(),
                "one_time_prekeys": [
                    {"id": 1, "key": base64.b64encode(b"otpk_1_32bytes_alice").decode()},
                    {"id": 2, "key": base64.b64encode(b"otpk_2_32bytes_alice").decode()},
                    {"id": 3, "key": base64.b64encode(b"otpk_3_32bytes_alice").decode()}
                ]
            }
            
            response = self.session.post(
                f"{BACKEND_URL}/prekeys",
                json=payload,
                timeout=10
            )
            
            if response.status_code == 200:
                data = response.json()
                if data.get('success') and data.get('user_id') == self.test_user_id:
                    self.log_test("PreKey Bundle Upload", True, f"PreKeys uploaded for {self.test_user_id}")
                else:
                    self.log_test("PreKey Bundle Upload", False, f"Unexpected response: {data}")
            else:
                self.log_test("PreKey Bundle Upload", False, f"HTTP {response.status_code}: {response.text}")
        
        except Exception as e:
            self.log_test("PreKey Bundle Upload", False, f"Exception: {str(e)}")

    def test_get_prekey_bundle(self):
        """Test GET /prekeys/{user_id}"""
        try:
            response = self.session.get(
                f"{BACKEND_URL}/prekeys/{self.test_user_id}",
                timeout=10
            )
            
            if response.status_code == 200:
                data = response.json()
                if (data.get('user_id') == self.test_user_id and 
                    data.get('identity_key') == self.test_identity_key and
                    data.get('signed_prekey_id') == 1):
                    # Should have consumed a one-time prekey
                    has_otpk = data.get('one_time_prekey_id') is not None
                    self.log_test("Get PreKey Bundle", True, 
                                f"Retrieved bundle, OTPK consumed: {has_otpk}")
                else:
                    self.log_test("Get PreKey Bundle", False, f"Data mismatch: {data}")
            elif response.status_code == 404:
                self.log_test("Get PreKey Bundle", False, "PreKey bundle not found")
            else:
                self.log_test("Get PreKey Bundle", False, f"HTTP {response.status_code}: {response.text}")
        
        except Exception as e:
            self.log_test("Get PreKey Bundle", False, f"Exception: {str(e)}")

    def test_store_message(self):
        """Test POST /messages"""
        try:
            # Register second user for message recipient
            self.session.post(f"{BACKEND_URL}/users/register", json={
                "user_id": self.test_user2_id,
                "display_name": self.test_user2_display_name,
                "identity_key": self.test_user2_identity_key
            })
            
            # Create encrypted message
            encrypted_payload = base64.b64encode(
                b"Hello Bob! This is an encrypted message from Alice using X3DH and Double Ratchet"
            ).decode()
            
            message_signature = base64.b64encode(
                b"message_signature_64bytes_hmac_sha256"
            ).decode()
            
            payload = {
                "sender_id": self.test_user_id,
                "recipient_id": self.test_user2_id,
                "payload": encrypted_payload,
                "signature": message_signature
            }
            
            response = self.session.post(
                f"{BACKEND_URL}/messages",
                json=payload,
                timeout=10
            )
            
            if response.status_code == 200:
                data = response.json()
                if data.get('success') and 'message_id' in data:
                    self.message_id = data['message_id']  # Store for later tests
                    self.log_test("Store Message", True, f"Message stored with ID: {self.message_id[:8]}...")
                else:
                    self.log_test("Store Message", False, f"Unexpected response: {data}")
            else:
                self.log_test("Store Message", False, f"HTTP {response.status_code}: {response.text}")
        
        except Exception as e:
            self.log_test("Store Message", False, f"Exception: {str(e)}")

    def test_get_pending_messages(self):
        """Test GET /messages/{user_id}"""
        try:
            response = self.session.get(
                f"{BACKEND_URL}/messages/{self.test_user2_id}",
                timeout=10
            )
            
            if response.status_code == 200:
                data = response.json()
                messages = data.get('messages', [])
                count = data.get('count', 0)
                
                if count > 0:
                    # Check if our message is in the list
                    found_message = any(
                        msg.get('sender_id') == self.test_user_id and
                        msg.get('recipient_id') == self.test_user2_id
                        for msg in messages
                    )
                    if found_message:
                        self.log_test("Get Pending Messages", True, f"Retrieved {count} messages")
                    else:
                        self.log_test("Get Pending Messages", False, "Expected message not found")
                else:
                    self.log_test("Get Pending Messages", False, "No pending messages found")
            else:
                self.log_test("Get Pending Messages", False, f"HTTP {response.status_code}: {response.text}")
        
        except Exception as e:
            self.log_test("Get Pending Messages", False, f"Exception: {str(e)}")

    def test_peer_discovery(self):
        """Test POST /peers and GET /peers"""
        try:
            # Register peer
            payload = {
                "user_id": self.test_user_id,
                "transport": "internet",
                "address": "192.168.1.100",
                "port": 8080
            }
            
            response = self.session.post(
                f"{BACKEND_URL}/peers",
                json=payload,
                timeout=10
            )
            
            if response.status_code == 200:
                data = response.json()
                if data.get('success'):
                    self.log_test("Register Peer", True, f"Peer {self.test_user_id} registered")
                    
                    # Now test getting peers
                    time.sleep(0.5)  # Brief delay
                    
                    response = self.session.get(f"{BACKEND_URL}/peers", timeout=10)
                    if response.status_code == 200:
                        peers_data = response.json()
                        peers = peers_data.get('peers', [])
                        
                        # Check if our peer is in the list
                        found_peer = any(
                            peer.get('user_id') == self.test_user_id
                            for peer in peers
                        )
                        
                        if found_peer:
                            self.log_test("Get Peers", True, f"Found {len(peers)} peers")
                        else:
                            self.log_test("Get Peers", False, "Registered peer not found in list")
                    else:
                        self.log_test("Get Peers", False, f"HTTP {response.status_code}: {response.text}")
                else:
                    self.log_test("Register Peer", False, f"Unexpected response: {data}")
            else:
                self.log_test("Register Peer", False, f"HTTP {response.status_code}: {response.text}")
        
        except Exception as e:
            self.log_test("Register Peer", False, f"Exception: {str(e)}")

    def test_stats_endpoint(self):
        """Test GET /stats"""
        try:
            response = self.session.get(f"{BACKEND_URL}/stats", timeout=10)
            
            if response.status_code == 200:
                data = response.json()
                required_fields = ['total_users', 'total_messages', 'pending_messages', 'online_users']
                
                if all(field in data for field in required_fields):
                    stats_summary = (f"Users: {data['total_users']}, "
                                   f"Messages: {data['total_messages']}, "
                                   f"Pending: {data['pending_messages']}, "
                                   f"Online: {data['online_users']}")
                    self.log_test("Network Stats", True, stats_summary)
                else:
                    self.log_test("Network Stats", False, f"Missing fields in response: {data}")
            else:
                self.log_test("Network Stats", False, f"HTTP {response.status_code}: {response.text}")
        
        except Exception as e:
            self.log_test("Network Stats", False, f"Exception: {str(e)}")

    def run_all_tests(self):
        """Run all backend tests"""
        print("🚀 Starting XAMTON Backend API Tests")
        print(f"📡 Backend URL: {BACKEND_URL}")
        print("=" * 50)
        
        # Test basic connectivity first
        self.test_health_check()
        self.test_root_endpoint()
        
        # Test user management
        self.test_user_registration()
        self.test_get_user()
        
        # Test prekey bundles for E2E encryption
        self.test_prekey_bundle_upload()
        self.test_get_prekey_bundle()
        
        # Test store-and-forward messaging
        self.test_store_message()
        self.test_get_pending_messages()
        
        # Test peer discovery
        self.test_peer_discovery()
        
        # Test statistics
        self.test_stats_endpoint()
        
        print("\n" + "=" * 50)
        print("📊 Test Summary:")
        print(f"✅ Passed: {self.test_results['passed']}")
        print(f"❌ Failed: {self.test_results['failed']}")
        
        if self.test_results['errors']:
            print("\n🔍 Failed Tests Details:")
            for error in self.test_results['errors']:
                print(f"  • {error}")
        
        return self.test_results['failed'] == 0

if __name__ == "__main__":
    tester = XAMTONTester()
    success = tester.run_all_tests()
    
    if not success:
        print(f"\n❌ Some tests failed. Check backend logs for details.")
        sys.exit(1)
    else:
        print(f"\n🎉 All tests passed! XAMTON backend is working correctly.")
        sys.exit(0)