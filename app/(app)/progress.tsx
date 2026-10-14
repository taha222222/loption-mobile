import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { theme } from '../../src/theme';

export default function ProgressScreen() {
  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Progress</Text>
        <TouchableOpacity style={styles.checkInButton}>
          <Text style={styles.checkInText}>Check In</Text>
        </TouchableOpacity>
      </View>

      <LinearGradient
        colors={['#1e293b', '#0f172a']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.weightCard}
      >
        <Text style={styles.weightLabel}>Current Weight</Text>
        <Text style={styles.weightValue}>74.5 <Text style={styles.weightUnit}>kg</Text></Text>
        <View style={styles.weightChange}>
          <Ionicons name="trending-down" size={16} color={theme.colors.success} />
          <Text style={styles.weightChangeText}>-2.5 kg this month</Text>
        </View>
      </LinearGradient>

      <View style={styles.statsGrid}>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>1,850</Text>
          <Text style={styles.statLabel}>Avg Calories</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>125g</Text>
          <Text style={styles.statLabel}>Avg Protein</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>74.5kg</Text>
          <Text style={styles.statLabel}>Current Weight</Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Weekly Activity</Text>
        <View style={styles.weekBars}>
          {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((day, index) => (
            <View key={index} style={styles.barColumn}>
              <View style={[styles.bar, { height: [45, 60, 35, 50, 70, 40, 30][index] }]} />
              <Text style={styles.barLabel}>{day}</Text>
            </View>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.xl,
    paddingTop: theme.spacing.xl,
    paddingBottom: theme.spacing.md,
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
    color: theme.colors.textDark,
  },
  checkInButton: {
    backgroundColor: theme.colors.gold,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.sm,
    borderRadius: 24,
  },
  checkInText: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.colors.dark,
  },
  weightCard: {
    margin: theme.spacing.xl,
    borderRadius: 24,
    padding: theme.spacing.xl,
    alignItems: 'center',
  },
  weightLabel: {
    fontSize: 14,
    color: theme.colors.textWhite,
    opacity: 0.8,
  },
  weightValue: {
    fontSize: 48,
    fontWeight: '700',
    color: theme.colors.gold,
    marginVertical: theme.spacing.sm,
  },
  weightUnit: {
    fontSize: 20,
    fontWeight: '400',
  },
  weightChange: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  weightChangeText: {
    fontSize: 14,
    color: theme.colors.success,
  },
  statsGrid: {
    flexDirection: 'row',
    paddingHorizontal: theme.spacing.xl,
    gap: theme.spacing.md,
    marginBottom: theme.spacing.xl,
  },
  statCard: {
    flex: 1,
    backgroundColor: theme.colors.card,
    borderRadius: 16,
    padding: theme.spacing.lg,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  statValue: {
    fontSize: 20,
    fontWeight: '700',
    color: theme.colors.gold,
  },
  statLabel: {
    fontSize: 12,
    color: theme.colors.textLight,
    marginTop: 4,
  },
  section: {
    paddingHorizontal: theme.spacing.xl,
    marginBottom: theme.spacing.xl,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: theme.colors.textDark,
    marginBottom: theme.spacing.lg,
  },
  weekBars: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'flex-end',
    height: 120,
  },
  barColumn: {
    alignItems: 'center',
    width: 40,
  },
  bar: {
    width: 30,
    backgroundColor: theme.colors.gold,
    borderRadius: 8,
    marginBottom: theme.spacing.sm,
  },
  barLabel: {
    fontSize: 12,
    color: theme.colors.textLight,
  },
});