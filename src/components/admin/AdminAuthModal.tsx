import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../../theme';
import { useAdminStore } from '../../stores/adminStore';

interface AdminAuthModalProps {
  visible: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export const AdminAuthModal: React.FC<AdminAuthModalProps> = ({
  visible,
  onClose,
  onSuccess,
}) => {
  const [securityPhrase, setSecurityPhrase] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { verifyAdminAuth, setAdminAuth } = useAdminStore();

  const handleVerify = async () => {
    if (!securityPhrase) {
      setError('Please enter your security phrase');
      return;
    }
    
    setLoading(true);
    setError('');
    
    const isValid = await verifyAdminAuth(securityPhrase);
    
    if (isValid) {
      setAdminAuth(true);
      onSuccess();
      onClose();
      setSecurityPhrase('');
    } else {
      setError('Invalid security phrase');
    }
    
    setLoading(false);
  };

  const handleClose = () => {
    setSecurityPhrase('');
    setError('');
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
    >
      <View style={styles.overlay}>
        <LinearGradient
          colors={['#0F1115', '#171A21']}
          style={styles.modalCard}
        >
          <TouchableOpacity style={styles.closeButton} onPress={handleClose}>
            <Ionicons name="close" size={24} color="#9CA3AF" />
          </TouchableOpacity>

          <View style={styles.iconContainer}>
            <Ionicons name="shield-checkmark" size={48} color="#D4A757" />
          </View>

          <Text style={styles.title}>Admin Verification</Text>
          
          <Text style={styles.subtitle}>
            Enter your security phrase to access the admin dashboard
          </Text>

          <TextInput
            style={styles.input}
            placeholder="Security phrase"
            placeholderTextColor="#6B7280"
            value={securityPhrase}
            onChangeText={setSecurityPhrase}
            secureTextEntry
            textAlign="center"
            autoCapitalize="none"
          />

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <TouchableOpacity 
            style={styles.verifyButton}
            onPress={handleVerify}
            disabled={loading}
          >
            <LinearGradient
              colors={['#D4A757', '#B8860B']}
              style={styles.verifyGradient}
            >
              {loading ? (
                <ActivityIndicator size="small" color="#0F1115" />
              ) : (
                <>
                  <Text style={styles.verifyText}>Verify & Access</Text>
                  <Ionicons name="arrow-forward" size={18} color="#0F1115" />
                </>
              )}
            </LinearGradient>
          </TouchableOpacity>

          <TouchableOpacity onPress={handleClose} style={styles.cancelButton}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </LinearGradient>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalCard: {
    width: '85%',
    borderRadius: 32,
    padding: theme.spacing.xl,
    alignItems: 'center',
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  closeButton: {
    position: 'absolute',
    top: 16,
    right: 16,
    padding: 8,
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(212,167,87,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.spacing.lg,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: theme.spacing.sm,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: '#9CA3AF',
    textAlign: 'center',
    marginBottom: theme.spacing.xl,
  },
  input: {
    width: '100%',
    backgroundColor: '#1F2937',
    borderRadius: 16,
    padding: 16,
    fontSize: 16,
    color: '#FFFFFF',
    marginBottom: theme.spacing.lg,
  },
  errorText: {
    color: '#EF4444',
    fontSize: 13,
    marginBottom: theme.spacing.md,
  },
  verifyButton: {
    width: '100%',
    borderRadius: 40,
    overflow: 'hidden',
    marginBottom: theme.spacing.md,
  },
  verifyGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    gap: 8,
  },
  verifyText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0F1115',
  },
  cancelButton: {
    paddingVertical: theme.spacing.sm,
  },
  cancelText: {
    color: '#6B7280',
    fontSize: 14,
  },
});