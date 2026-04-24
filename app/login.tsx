import React, { useState } from 'react';
import {
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Modal,
} from 'react-native';
import { Text, View } from '@/components/Themed';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import SearchableModal from '@/components/SearchableModal';
import { COUNTRIES, type Country } from '@/lib/countries';
import { loadCurrencies, type Currency } from '@/lib/currency';
import { useEffect } from 'react';

export default function LoginScreen() {
  const { signIn, signUp } = useAuth();
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [selectedCountry, setSelectedCountry] = useState('Uganda');
  const [selectedCurrency, setSelectedCurrency] = useState('UGX');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Forgot password OTP flow
  const [showResetModal, setShowResetModal] = useState(false);
  const [resetStep, setResetStep] = useState<'email' | 'otp'>('email');
  const [resetEmail, setResetEmail] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [resetLoading, setResetLoading] = useState(false);

  // Pickers
  const [showCountryPicker, setShowCountryPicker] = useState(false);
  const [showCurrencyPicker, setShowCurrencyPicker] = useState(false);
  const [currencies, setCurrencies] = useState<Currency[]>([]);

  useEffect(() => {
    if (isSignUp) {
      loadCurrencies().then(setCurrencies);
    }
  }, [isSignUp]);

  const handleSignIn = async () => {
    if (!email || !password) {
      Alert.alert('Error', 'Please enter email and password');
      return;
    }
    setLoading(true);
    const timeout = setTimeout(() => {
      Alert.alert(
        'Slow Connection',
        'Login is taking too long. Please check your internet connection and try again.',
        [{ text: 'OK' }]
      );
    }, 12000);
    const { error } = await signIn(email, password);
    clearTimeout(timeout);
    if (error) {
      Alert.alert('Login Failed', error.message);
    }
    setLoading(false);
  };

  // Step 1: Send OTP to email
  const handleSendOtp = async () => {
    if (!resetEmail.trim()) {
      Alert.alert('Error', 'Please enter your email address');
      return;
    }
    setResetLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(resetEmail.trim());
    setResetLoading(false);
    if (error) {
      Alert.alert('Error', error.message);
    } else {
      setResetStep('otp');
      Alert.alert(
        'Code Sent ✉️',
        `We sent a 6-digit code to ${resetEmail.trim()}.\n\nCheck your email (including spam folder) and enter the code below.`
      );
    }
  };

  // Step 2: Verify OTP and set new password
  const handleResetPassword = async () => {
    if (!otpCode.trim()) { Alert.alert('Error', 'Enter the 6-digit code from your email'); return; }
    if (!newPassword.trim() || newPassword.trim().length < 6) { Alert.alert('Error', 'New password must be at least 6 characters'); return; }
    if (newPassword !== confirmPassword) { Alert.alert('Error', 'Passwords do not match'); return; }

    setResetLoading(true);
    // Verify OTP token
    const { error: verifyError } = await supabase.auth.verifyOtp({
      email: resetEmail.trim(),
      token: otpCode.trim(),
      type: 'recovery',
    });

    if (verifyError) {
      setResetLoading(false);
      Alert.alert('Invalid Code', 'The code is incorrect or has expired. Please try again.');
      return;
    }

    // Now update the password (user is now authenticated via OTP)
    const { error: updateError } = await supabase.auth.updateUser({
      password: newPassword.trim(),
    });
    setResetLoading(false);

    if (updateError) {
      Alert.alert('Error', updateError.message);
    } else {
      Alert.alert('Password Reset ✅', 'Your password has been changed. You can now sign in with your new password.');
      // Sign out so they login with new password
      await supabase.auth.signOut();
      closeResetModal();
    }
  };

  const closeResetModal = () => {
    setShowResetModal(false);
    setResetStep('email');
    setResetEmail('');
    setOtpCode('');
    setNewPassword('');
    setConfirmPassword('');
  };

  const openResetModal = () => {
    setResetEmail(email.trim()); // Pre-fill with login email if entered
    setShowResetModal(true);
  };

  const handleSignUp = async () => {
    if (!email || !password || !fullName || !businessName || !selectedCountry || !selectedCurrency) {
      Alert.alert('Error', 'Please fill in all fields including Country and Currency');
      return;
    }
    if (password.length < 6) {
      Alert.alert('Error', 'Password must be at least 6 characters');
      return;
    }
    setLoading(true);
    const { error } = await signUp(email, password, fullName, businessName, selectedCountry, selectedCurrency);
    if (error) {
      Alert.alert('Sign Up Failed', error.message);
    }
    setLoading(false);
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Logo / App Name */}
        <View style={styles.logoContainer}>
          <Text style={styles.appName}>📒 YourBooks</Text>
          <Text style={styles.tagline}>
            {isSignUp ? 'Create your business account' : 'Smart Accounting for Smart Business'}
          </Text>
        </View>

        {/* Form */}
        <View style={styles.formContainer}>
          {isSignUp && (
            <>
              <TextInput
                style={styles.input}
                placeholder="Your Full Name"
                placeholderTextColor="#999"
                value={fullName}
                onChangeText={setFullName}
                autoCapitalize="words"
              />
              <TextInput
                style={styles.input}
                placeholder="Business Name"
                placeholderTextColor="#999"
                value={businessName}
                onChangeText={setBusinessName}
                autoCapitalize="words"
              />

              <View style={styles.pickerContainer}>
                <Text style={styles.pickerLabel}>Base Country</Text>
                <TouchableOpacity 
                  style={styles.pickerTrigger} 
                  onPress={() => setShowCountryPicker(true)}
                >
                  <Text style={styles.pickerTriggerText}>{selectedCountry}</Text>
                  <FontAwesome name="search" size={14} color="#888" />
                </TouchableOpacity>
              </View>

              <View style={styles.pickerContainer}>
                <Text style={styles.pickerLabel}>Base Currency</Text>
                <TouchableOpacity 
                  style={styles.pickerTrigger} 
                  onPress={() => setShowCurrencyPicker(true)}
                >
                  <Text style={styles.pickerTriggerText}>{selectedCurrency}</Text>
                  <FontAwesome name="search" size={14} color="#888" />
                </TouchableOpacity>
              </View>

              <SearchableModal
                visible={showCountryPicker}
                onClose={() => setShowCountryPicker(false)}
                title="Select Country"
                data={COUNTRIES}
                labelExtractor={(c: Country) => c.name}
                valueExtractor={(c: Country) => c.name}
                subLabelExtractor={(c: Country) => `Default: ${c.currency}`}
                onSelect={(c: Country) => {
                  setSelectedCountry(c.name);
                  setSelectedCurrency(c.currency);
                }}
              />

              <SearchableModal
                visible={showCurrencyPicker}
                onClose={() => setShowCurrencyPicker(false)}
                title="Select Currency"
                data={currencies}
                labelExtractor={(c: Currency) => `${c.code} - ${c.name}`}
                valueExtractor={(c: Currency) => c.code}
                subLabelExtractor={(c: Currency) => c.symbol}
                onSelect={(c: Currency) => setSelectedCurrency(c.code)}
              />
            </>
          )}

          <TextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor="#999"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
          />

          <View style={styles.passwordContainer}>
            <TextInput
              style={styles.passwordInput}
              placeholder="Password"
              placeholderTextColor="#999"
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
            />
            <TouchableOpacity
              style={styles.eyeButton}
              onPress={() => setShowPassword(!showPassword)}
            >
              <FontAwesome name={showPassword ? 'eye' : 'eye-slash'} size={18} color="#888" />
            </TouchableOpacity>
          </View>

          {/* Submit Button */}
          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={isSignUp ? handleSignUp : handleSignIn}
            disabled={loading}
          >
            {loading ? (
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <ActivityIndicator color="#fff" />
                {isSignUp && <Text style={[styles.buttonText, { marginLeft: 10 }]}>Creating Account...</Text>}
              </View>
            ) : (
              <Text style={styles.buttonText}>
                {isSignUp ? 'Create Account' : 'Sign In'}
              </Text>
            )}
          </TouchableOpacity>

          {/* Toggle */}
          <TouchableOpacity
            style={styles.toggleButton}
            onPress={() => setIsSignUp(!isSignUp)}
          >
            <Text style={styles.toggleText}>
              {isSignUp
                ? 'Already have an account? Sign In'
                : "Don't have an account? Sign Up"}
            </Text>
          </TouchableOpacity>

          {/* Forgot Password */}
          {!isSignUp && (
            <TouchableOpacity
              style={styles.forgotButton}
              onPress={openResetModal}
            >
              <Text style={styles.forgotText}>Forgot Password?</Text>
            </TouchableOpacity>
          )}

          {/* Demo Account */}
          {!isSignUp && (
            <TouchableOpacity
              style={styles.demoButton}
              onPress={async () => {
                setLoading(true);
                await supabase.auth.signOut(); // Ensure fresh session
                const { error } = await signIn('kissakian@gmail.com', 'demo@123');
                if (error) Alert.alert('Demo Login Failed', error.message);
                setLoading(false);
              }}
              disabled={loading}
            >
              <Text style={styles.demoButtonText}>🚀 Try Demo Account</Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>

      {/* Forgot Password OTP Modal */}
      <Modal visible={showResetModal} animationType="slide" transparent>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <ScrollView>
              <Text style={styles.modalTitle}>
                {resetStep === 'email' ? 'Reset Password' : 'Enter Code & New Password'}
              </Text>

              {resetStep === 'email' ? (
                <>
                  <Text style={styles.modalHint}>
                    Enter your email address. We'll send you a 6-digit code to reset your password.
                  </Text>
                  <TextInput
                    style={styles.modalInput}
                    placeholder="Email address"
                    placeholderTextColor="#555"
                    value={resetEmail}
                    onChangeText={setResetEmail}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoFocus
                  />
                  <TouchableOpacity
                    style={[styles.modalBtn, resetLoading && { opacity: 0.6 }]}
                    onPress={handleSendOtp}
                    disabled={resetLoading}
                  >
                    {resetLoading ? <ActivityIndicator color="#fff" /> : (
                      <Text style={styles.modalBtnText}>Send Reset Code</Text>
                    )}
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <Text style={styles.modalHint}>
                    Check your email ({resetEmail}) for a 6-digit code. Enter it below with your new password.
                  </Text>
                  <TextInput
                    style={[styles.modalInput, { textAlign: 'center', fontSize: 24, letterSpacing: 8 }]}
                    placeholder="000000"
                    placeholderTextColor="#555"
                    value={otpCode}
                    onChangeText={setOtpCode}
                    keyboardType="number-pad"
                    maxLength={6}
                    autoFocus
                  />
                  <TextInput
                    style={styles.modalInput}
                    placeholder="New password (min 6 chars)"
                    placeholderTextColor="#555"
                    value={newPassword}
                    onChangeText={setNewPassword}
                    secureTextEntry
                  />
                  <TextInput
                    style={styles.modalInput}
                    placeholder="Confirm new password"
                    placeholderTextColor="#555"
                    value={confirmPassword}
                    onChangeText={setConfirmPassword}
                    secureTextEntry
                  />
                  <TouchableOpacity
                    style={[styles.modalBtn, resetLoading && { opacity: 0.6 }]}
                    onPress={handleResetPassword}
                    disabled={resetLoading}
                  >
                    {resetLoading ? <ActivityIndicator color="#fff" /> : (
                      <Text style={styles.modalBtnText}>Reset Password</Text>
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => setResetStep('email')} style={{ marginTop: 10, alignItems: 'center' }}>
                    <Text style={{ color: '#aaa', fontSize: 13 }}>← Back / Resend code</Text>
                  </TouchableOpacity>
                </>
              )}

              <TouchableOpacity style={styles.modalCancel} onPress={closeResetModal}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
        </KeyboardAvoidingView>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 48,
    backgroundColor: 'transparent',
  },
  appName: {
    fontSize: 36,
    fontWeight: 'bold',
    color: '#e94560',
    marginBottom: 8,
  },
  tagline: {
    fontSize: 16,
    color: '#aaa',
    textAlign: 'center',
  },
  formContainer: {
    backgroundColor: 'transparent',
  },
  input: {
    backgroundColor: '#16213e',
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: '#fff',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#0f3460',
  },
  pickerTrigger: {
    backgroundColor: '#16213e',
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#0f3460',
    marginBottom: 16,
  },
  pickerTriggerText: {
    color: '#fff',
    fontSize: 16,
  },
  pickerLabel: {
    fontSize: 14,
    color: '#888',
    marginBottom: 8,
  },
  button: {
    backgroundColor: '#e94560',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  toggleButton: {
    marginTop: 20,
    alignItems: 'center',
  },
  toggleText: {
    color: '#e94560',
    fontSize: 14,
  },
  forgotButton: {
    marginTop: 12,
    alignItems: 'center',
    paddingVertical: 8,
  },
  forgotText: {
    color: '#888',
    fontSize: 13,
    textDecorationLine: 'underline',
  },
  passwordContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#16213e',
    borderRadius: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#0f3460',
  },
  passwordInput: {
    flex: 1,
    padding: 16,
    fontSize: 16,
    color: '#fff',
  },
  eyeButton: {
    paddingHorizontal: 14,
    paddingVertical: 16,
  },
  demoButton: {
    marginTop: 16,
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#0f3460',
    backgroundColor: '#16213e',
  },
  demoButtonText: {
    color: '#aaa',
    fontSize: 15,
    fontWeight: '600',
  },
  // Modal styles
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', padding: 20 },
  modalContent: { backgroundColor: '#1a1a2e', borderRadius: 20, padding: 24, maxHeight: '80%' },
  modalTitle: { fontSize: 22, fontWeight: 'bold', color: '#fff', marginBottom: 12 },
  modalHint: { color: '#aaa', fontSize: 14, marginBottom: 16, lineHeight: 20 },
  modalInput: { backgroundColor: '#16213e', borderRadius: 12, padding: 14, fontSize: 16, color: '#fff', marginBottom: 12, borderWidth: 1, borderColor: '#0f3460' },
  modalBtn: { backgroundColor: '#e94560', borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 4 },
  modalBtnText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  modalCancel: { padding: 14, alignItems: 'center', marginTop: 8 },
  modalCancelText: { color: '#888', fontSize: 15 },
  pickerContainer: {
    marginBottom: 20,
    backgroundColor: 'transparent',
  },
  pickerLabel: {
    fontSize: 14,
    color: '#aaa',
    marginBottom: 10,
    marginLeft: 4,
  },
  chipScroll: {
    flexDirection: 'row',
  },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: '#16213e',
    marginRight: 10,
    borderWidth: 1,
    borderColor: '#0f3460',
  },
  chipSelected: {
    backgroundColor: '#e94560',
    borderColor: '#e94560',
  },
  chipText: {
    color: '#aaa',
    fontSize: 14,
  },
  chipTextSelected: {
    color: '#fff',
    fontWeight: 'bold',
  },
});
