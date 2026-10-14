import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { theme } from '../../src/theme';
import { Button } from '../../src/components/ui/Button';
import { useAuthStore } from '../../src/stores/authStore';
import { useCollaboratorStore } from '../../src/stores/collaboratorStore';

export default function CollaboratorProfile() {
  const { user, signOut } = useAuthStore();
  const { profile, fetchProfile } = useCollaboratorStore();

  useEffect(() => {
    fetchProfile();
  }, []);

  const handleSignOut = () => {
    Alert.alert(
      'Sign Out',
      'Are you sure you want to sign out?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out',
          style: 'destructive',
          onPress: async () => {
            await signOut();
            router.replace('/(auth)/login');
          },
        },
      ]
    );
  };

  const getInitials = () => {
    if (profile?.branch_name) {
      return profile.branch_name.charAt(0).toUpperCase();
    }
    return 'P';
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.title}>Partner Profile</Text>
        </View>

        {/* Profile Card */}
        <LinearGradient colors={['#1e293b', '#0f172a']} style={styles.profileCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{getInitials()}</Text>
          </View>
          <Text style={styles.branchName}>{profile?.branch_name || 'Loading...'}</Text>
          <Text style={styles.branchEmail}>{user?.email}</Text>
          <View style={styles.branchBadge}>
            <Text style={styles.branchBadgeText}>Active Partner</Text>
          </View>
        </LinearGradient>

        {/* Stats */}
        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>50%</Text>
            <Text style={styles.statLabel}>Revenue Share</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statValue}>500 MAD</Text>
            <Text style={styles.statLabel}>Min. Payout</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statValue}>Weekly</Text>
            <Text style={styles.statLabel}>Payout Frequency</Text>
          </View>
        </View>

        {/* Branch Info */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Branch Information</Text>
          <View style={styles.infoRow}>
            <Ionicons name="location-outline" size={20} color="#9CA3AF" />
            <Text style={styles.infoText}>{profile?.branch_address || 'No address set'}</Text>
          </View>
          <View style={styles.infoRow}>
            <Ionicons name="call-outline" size={20} color="#9CA3AF" />
            <Text style={styles.infoText}>{profile?.branch_phone || 'No phone set'}</Text>
          </View>
          <View style={styles.infoRow}>
            <Ionicons name="mail-outline" size={20} color="#9CA3AF" />
            <Text style={styles.infoText}>{profile?.branch_email || user?.email}</Text>
          </View>
        </View>

        {/* Menu Items */}
        <View style={styles.menuSection}>
          <TouchableOpacity style={styles.menuItem}>
            <Ionicons name="document-text-outline" size={24} color={theme.colors.textLight} />
            <Text style={styles.menuText}>Contract Information</Text>
            <Ionicons name="chevron-forward" size={20} color={theme.colors.textLight} />
          </TouchableOpacity>

          <TouchableOpacity style={styles.menuItem}>
            <Ionicons name="help-circle-outline" size={24} color={theme.colors.textLight} />
            <Text style={styles.menuText}>Help & Support</Text>
            <Ionicons name="chevron-forward" size={20} color={theme.colors.textLight} />
          </TouchableOpacity>

          <TouchableOpacity style={styles.menuItem}>
            <Ionicons name="shield-checkmark-outline" size={24} color={theme.colors.textLight} />
            <Text style={styles.menuText}>Partner Guidelines</Text>
            <Ionicons name="chevron-forward" size={20} color={theme.colors.textLight} />
          </TouchableOpacity>
        </View>

        {/* Sign Out Button */}
        <Button
          title="Sign Out"
          variant="danger"
          onPress={handleSignOut}
          style={styles.signOutButton}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F1115',
  },
  header: {
    paddingHorizontal: theme.spacing.xl,
    paddingTop: theme.spacing.xl,
    paddingBottom: theme.spacing.md,
  },
  title: {
    fontSize: theme.typography.sizes['3xl'],
    fontWeight: theme.typography.weights.bold,
    color: '#FFFFFF',
  },
  profileCard: {
    alignItems: 'center',
    marginHorizontal: theme.spacing.xl,
    marginBottom: theme.spacing.xl,
    padding: theme.spacing.xl,
    borderRadius: theme.spacing.lg,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#D4A757',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.spacing.md,
  },
  avatarText: {
    fontSize: 32,
    fontWeight: theme.typography.weights.bold,
    color: '#0F1115',
  },
  branchName: {
    fontSize: theme.typography.sizes.xl,
    fontWeight: theme.typography.weights.bold,
    color: '#FFFFFF',
  },
  branchEmail: {
    fontSize: theme.typography.sizes.sm,
    color: '#9CA3AF',
    marginTop: 4,
  },
  branchBadge: {
    backgroundColor: '#10b98120',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 4,
    borderRadius: theme.spacing.md,
    marginTop: theme.spacing.sm,
  },
  branchBadgeText: {
    fontSize: theme.typography.sizes.xs,
    color: '#10b981',
    fontWeight: theme.typography.weights.semibold,
  },
  statsRow: {
    flexDirection: 'row',
    backgroundColor: '#1E293B',
    marginHorizontal: theme.spacing.xl,
    marginBottom: theme.spacing.xl,
    padding: theme.spacing.lg,
    borderRadius: theme.spacing.lg,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    fontSize: theme.typography.sizes.lg,
    fontWeight: theme.typography.weights.bold,
    color: '#D4A757',
  },
  statLabel: {
    fontSize: theme.typography.sizes.xs,
    color: '#9CA3AF',
    marginTop: 4,
  },
  statDivider: {
    width: 1,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  section: {
    backgroundColor: '#1E293B',
    marginHorizontal: theme.spacing.xl,
    marginBottom: theme.spacing.xl,
    padding: theme.spacing.lg,
    borderRadius: theme.spacing.lg,
  },
  sectionTitle: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.semibold,
    color: '#FFFFFF',
    marginBottom: theme.spacing.md,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.sm,
  },
  infoText: {
    flex: 1,
    fontSize: theme.typography.sizes.sm,
    color: '#9CA3AF',
  },
  menuSection: {
    marginHorizontal: theme.spacing.xl,
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.xl,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E293B',
    padding: theme.spacing.lg,
    borderRadius: theme.spacing.lg,
    gap: theme.spacing.md,
  },
  menuText: {
    flex: 1,
    fontSize: theme.typography.sizes.md,
    color: '#FFFFFF',
  },
  signOutButton: {
    marginHorizontal: theme.spacing.xl,
    marginBottom: theme.spacing.xl,
  },
});