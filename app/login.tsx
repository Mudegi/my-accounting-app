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
} from 'react-native';
import { Text, View } from '@/components/Themed';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useAuth } from '@/lib/auth';

export default function LoginScreen() {
  const { signIn, signUp, resetPassword } = useAuth();
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [loading, setLoading] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

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

  const handleForgotPassword = async () => {
    if (!email.trim()) {
      Alert.alert('Enter Email', 'Please enter your email address first, then tap "Forgot Password".');
      return;
    }
    setResetLoading(true);
    const { error } = await resetPassword(email.trim());
    setResetLoading(false);
    if (error) {
      Alert.alert('Error', error.message);
    } else {
      Alert.alert(
        'Password Reset Sent',
        `We've sent a password reset link to ${email.trim()}.\n\nCheck your email (including spam folder), tap the link, and set a new password.`,
        [{ text: 'OK' }]
      );
    }
  };

  const handleSignUp = async () => {
    if (!email || !password || !fullName || !businessName) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }
    if (password.length < 6) {
      Alert.alert('Error', 'Password must be at least 6 characters');
      return;
    }
    setLoading(true);
    const { error } = await signUp(email, password, fullName, businessName);
    if (error) {
      Alert.alert('Sign Up Failed', error.message);
    } else {
      Alert.alert('Success', 'Account created! Please check your email to verify, then sign in.');
      setIsSignUp(false);
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
              <ActivityIndicator color="#fff" />
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
              onPress={handleForgotPassword}
              disabled={resetLoading}
            >
              {resetLoading ? (
                <ActivityIndicator size="small" color="#888" />
              ) : (
                <Text style={styles.forgotText}>Forgot Password?</Text>
              )}
            </TouchableOpacity>
          )}

          {/* Demo Account */}
          {!isSignUp && (
            <TouchableOpacity
              style={styles.demoButton}
              onPress={async () => {
                setLoading(true);
                const { error } = await signIn('mudegiemma@gmail.com', 'mudegi@256');
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
});
