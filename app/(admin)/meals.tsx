import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Alert,
  Modal,
  TextInput,
  Switch,
  Image,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { theme } from '../../src/theme';
import { Button } from '../../src/components/ui/Button';
import { supabase } from '../../src/lib/supabase';
import * as ImagePicker from 'expo-image-picker';

interface Meal {
  id: string;
  name: string;
  price: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  category: string;
  popular: boolean;
  image_url: string | null;
  available: boolean;
}

const categories = [
  { id: 'high_protein', name: 'High Protein', icon: 'fitness-outline', color: '#3b82f6' },
  { id: 'low_calorie', name: 'Low Calorie', icon: 'leaf-outline', color: '#10b981' },
  { id: 'balanced', name: 'Balanced', icon: 'nutrition-outline', color: '#8b5cf6' },
  { id: 'drinks', name: 'Drinks', icon: 'cafe-outline', color: '#f59e0b' },
  { id: 'desserts', name: 'Desserts', icon: 'ice-cream-outline', color: '#ec4899' },
];

export default function AdminMeals() {
  const [meals, setMeals] = useState<Meal[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editingMeal, setEditingMeal] = useState<Meal | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [formData, setFormData] = useState({
    name: '',
    price: '',
    calories: '',
    protein: '',
    carbs: '',
    fat: '',
    category: 'high_protein',
    popular: false,
    available: true,
    image_url: '',
  });

  useEffect(() => {
    fetchMeals();
    requestMediaLibraryPermission();
  }, []);

  const requestMediaLibraryPermission = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Please grant camera roll permission to upload images');
    }
  };

  const fetchMeals = async () => {
    let query = supabase.from('meals').select('*').order('name');
    
    if (selectedCategory !== 'all') {
      query = query.eq('category', selectedCategory);
    }
    
    const { data } = await query;
    if (data) {
      setMeals(data);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchMeals();
    setRefreshing(false);
  };

const pickImage = async () => {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [4, 3],
    quality: 0.8,
    base64: true,  // Use base64 for more reliable upload
  });

  if (!result.canceled && result.assets[0].base64) {
    setUploadingImage(true);
    
    try {
      const fileName = `${Date.now()}.jpg`;
      
      // Convert base64 to array buffer
      const base64Data = result.assets[0].base64;
      const arrayBuffer = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
      
      // Upload to Supabase Storage
      const { error: uploadError } = await supabase.storage
        .from('meal-images')
        .upload(fileName, arrayBuffer, {
          contentType: 'image/jpeg',
          cacheControl: '3600',
          upsert: true,
        });
      
      if (uploadError) {
        console.error('Upload error:', uploadError);
        Alert.alert('Error', `Upload failed: ${uploadError.message}`);
        setUploadingImage(false);
        return;
      }
      
      // Get public URL
      const { data: publicUrlData } = supabase.storage
        .from('meal-images')
        .getPublicUrl(fileName);
      
      const imageUrl = publicUrlData.publicUrl;
      console.log('✅ Image uploaded, URL:', imageUrl);
      
      setFormData(prev => ({ ...prev, image_url: imageUrl }));
      
    } catch (error) {
      console.error('Upload error:', error);
      Alert.alert('Error', 'Failed to upload image');
    }
    
    setUploadingImage(false);
  }
};

  const handleAddMeal = () => {
    setEditingMeal(null);
    setFormData({
      name: '',
      price: '',
      calories: '',
      protein: '',
      carbs: '',
      fat: '',
      category: 'high_protein',
      popular: false,
      available: true,
      image_url: '',
    });
    setShowModal(true);
  };

  const handleEditMeal = (meal: Meal) => {
    setEditingMeal(meal);
    setFormData({
      name: meal.name,
      price: meal.price.toString(),
      calories: meal.calories.toString(),
      protein: meal.protein.toString(),
      carbs: meal.carbs.toString(),
      fat: meal.fat.toString(),
      category: meal.category,
      popular: meal.popular,
      available: meal.available,
      image_url: meal.image_url || '',
    });
    setShowModal(true);
  };

  const handleSaveMeal = async () => {
    if (!formData.name || !formData.price) {
      Alert.alert('Error', 'Please fill in required fields');
      return;
    }

    setLoading(true);

    const mealData = {
      name: formData.name,
      price: parseFloat(formData.price),
      calories: parseInt(formData.calories) || 0,
      protein: parseInt(formData.protein) || 0,
      carbs: parseInt(formData.carbs) || 0,
      fat: parseInt(formData.fat) || 0,
      category: formData.category,
      popular: formData.popular,
      available: formData.available,
      image_url: formData.image_url || null,
      updated_at: new Date().toISOString(),
    };

    let error;
    if (editingMeal) {
      const { error: updateError } = await supabase
        .from('meals')
        .update(mealData)
        .eq('id', editingMeal.id);
      error = updateError;
    } else {
      const { error: insertError } = await supabase
        .from('meals')
        .insert({ ...mealData, created_at: new Date().toISOString() });
      error = insertError;
    }

    if (error) {
      Alert.alert('Error', error.message);
    } else {
      Alert.alert('Success', editingMeal ? 'Meal updated' : 'Meal added');
      setShowModal(false);
      await fetchMeals();
    }
    setLoading(false);
  };

  const handleDeleteMeal = async (meal: Meal) => {
    Alert.alert(
      'Delete Meal',
      `Are you sure you want to delete "${meal.name}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const { error } = await supabase
              .from('meals')
              .delete()
              .eq('id', meal.id);
            
            if (error) {
              Alert.alert('Error', error.message);
            } else {
              await fetchMeals();
            }
          },
        },
      ]
    );
  };

  const handleToggleAvailable = async (meal: Meal) => {
    const { error } = await supabase
      .from('meals')
      .update({ available: !meal.available })
      .eq('id', meal.id);
    
    if (!error) {
      await fetchMeals();
    }
  };

  const getCategoryName = (categoryId: string) => {
    return categories.find(c => c.id === categoryId)?.name || categoryId;
  };

  const getCategoryColor = (categoryId: string) => {
    return categories.find(c => c.id === categoryId)?.color || '#9CA3AF';
  };

  const filteredMeals = selectedCategory === 'all' 
    ? meals 
    : meals.filter(m => m.category === selectedCategory);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Menu</Text>
        <TouchableOpacity style={styles.addButton} onPress={handleAddMeal}>
          <Ionicons name="add" size={24} color="#FFFFFF" />
        </TouchableOpacity>
      </View>

      {/* Category Filters */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterContainer}>
        <TouchableOpacity
          style={[styles.filterChip, selectedCategory === 'all' && styles.filterChipActive]}
          onPress={() => setSelectedCategory('all')}
        >
          <Text style={[styles.filterText, selectedCategory === 'all' && styles.filterTextActive]}>All</Text>
        </TouchableOpacity>
        {categories.map((cat) => (
          <TouchableOpacity
            key={cat.id}
            style={[styles.filterChip, selectedCategory === cat.id && styles.filterChipActive]}
            onPress={() => setSelectedCategory(cat.id)}
          >
            <Ionicons name={cat.icon as any} size={16} color={selectedCategory === cat.id ? '#FFFFFF' : cat.color} />
            <Text style={[styles.filterText, selectedCategory === cat.id && styles.filterTextActive]}>{cat.name}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#1d1d1f" />}
        contentContainerStyle={styles.content}
      >
        {filteredMeals.length === 0 ? (
          <BlurView intensity={20} tint="light" style={styles.emptyState}>
            <Ionicons name="restaurant-outline" size={64} color="rgba(0,0,0,0.2)" />
            <Text style={styles.emptyTitle}>No meals yet</Text>
            <Text style={styles.emptyText}>Tap + to add your first meal</Text>
          </BlurView>
        ) : (
          filteredMeals.map((meal) => (
            <View key={meal.id} style={styles.mealCard}>
              <View style={styles.cardHeader}>
                {meal.image_url ? (
                  <Image source={{ uri: meal.image_url }} style={styles.mealImage} />
                ) : (
                  <View style={styles.mealImagePlaceholder}>
                    <Ionicons name="restaurant-outline" size={24} color="#6B7280" />
                  </View>
                )}
                <View style={styles.mealInfo}>
                  <Text style={styles.mealName}>{meal.name}</Text>
                  <View style={styles.categoryBadge}>
                    <Ionicons name={categories.find(c => c.id === meal.category)?.icon as any} size={12} color={getCategoryColor(meal.category)} />
                    <Text style={[styles.categoryText, { color: getCategoryColor(meal.category) }]}>
                      {getCategoryName(meal.category)}
                    </Text>
                  </View>
                </View>
                <View style={styles.priceBadge}>
                  <Text style={styles.priceText}>{meal.price} MAD</Text>
                </View>
              </View>

              <View style={styles.nutritionRow}>
                <View style={styles.nutritionItem}>
                  <Text style={styles.nutritionValue}>{meal.calories}</Text>
                  <Text style={styles.nutritionLabel}>cal</Text>
                </View>
                <View style={styles.nutritionDivider} />
                <View style={styles.nutritionItem}>
                  <Text style={styles.nutritionValue}>{meal.protein}g</Text>
                  <Text style={styles.nutritionLabel}>protein</Text>
                </View>
                <View style={styles.nutritionDivider} />
                <View style={styles.nutritionItem}>
                  <Text style={styles.nutritionValue}>{meal.carbs}g</Text>
                  <Text style={styles.nutritionLabel}>carbs</Text>
                </View>
                <View style={styles.nutritionDivider} />
                <View style={styles.nutritionItem}>
                  <Text style={styles.nutritionValue}>{meal.fat}g</Text>
                  <Text style={styles.nutritionLabel}>fat</Text>
                </View>
              </View>

              <View style={styles.cardFooter}>
                <View style={styles.statusRow}>
                  <Switch
                    value={meal.available}
                    onValueChange={() => handleToggleAvailable(meal)}
                    trackColor={{ false: '#e5e5e7', true: '#D4A757' }}
                    thumbColor={meal.available ? '#FFFFFF' : '#FFFFFF'}
                  />
                  <Text style={styles.statusText}>{meal.available ? 'Available' : 'Unavailable'}</Text>
                </View>
                {meal.popular && (
                  <View style={styles.popularBadge}>
                    <Ionicons name="flame" size={12} color="#D4A757" />
                    <Text style={styles.popularText}>Popular</Text>
                  </View>
                )}
                <View style={styles.actionButtons}>
                  <TouchableOpacity onPress={() => handleEditMeal(meal)}>
                    <Ionicons name="create-outline" size={20} color="#3b82f6" />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => handleDeleteMeal(meal)}>
                    <Ionicons name="trash-outline" size={20} color="#ef4444" />
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          ))
        )}
      </ScrollView>

      {/* Add/Edit Meal Modal */}
      <Modal
        visible={showModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {editingMeal ? 'Edit Meal' : 'New Meal'}
              </Text>
              <TouchableOpacity onPress={() => setShowModal(false)}>
                <Ionicons name="close" size={24} color="#1d1d1f" />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              {/* Image Upload */}
              <TouchableOpacity style={styles.imageUpload} onPress={pickImage}>
                {uploadingImage ? (
                  <ActivityIndicator color="#D4A757" />
                ) : formData.image_url ? (
                  <Image source={{ uri: formData.image_url }} style={styles.uploadedImage} />
                ) : (
                  <>
                    <Ionicons name="cloud-upload-outline" size={32} color="#D4A757" />
                    <Text style={styles.imageUploadText}>Upload Image</Text>
                  </>
                )}
              </TouchableOpacity>

              <TextInput
                style={styles.modalInput}
                placeholder="Meal name"
                placeholderTextColor="#8e8e93"
                value={formData.name}
                onChangeText={(text) => setFormData(prev => ({ ...prev, name: text }))}
              />

              <TextInput
                style={styles.modalInput}
                placeholder="Price (MAD)"
                placeholderTextColor="#8e8e93"
                value={formData.price}
                onChangeText={(text) => setFormData(prev => ({ ...prev, price: text }))}
                keyboardType="numeric"
              />

              <Text style={styles.sectionLabel}>Nutrition</Text>
              <View style={styles.nutritionGrid}>
                <View style={styles.nutritionField}>
                  <Text style={styles.nutritionFieldLabel}>Calories</Text>
                  <TextInput
                    style={styles.nutritionFieldInput}
                    placeholder="0"
                    placeholderTextColor="#8e8e93"
                    value={formData.calories}
                    onChangeText={(text) => setFormData(prev => ({ ...prev, calories: text }))}
                    keyboardType="numeric"
                  />
                </View>
                <View style={styles.nutritionField}>
                  <Text style={styles.nutritionFieldLabel}>Protein (g)</Text>
                  <TextInput
                    style={styles.nutritionFieldInput}
                    placeholder="0"
                    placeholderTextColor="#8e8e93"
                    value={formData.protein}
                    onChangeText={(text) => setFormData(prev => ({ ...prev, protein: text }))}
                    keyboardType="numeric"
                  />
                </View>
                <View style={styles.nutritionField}>
                  <Text style={styles.nutritionFieldLabel}>Carbs (g)</Text>
                  <TextInput
                    style={styles.nutritionFieldInput}
                    placeholder="0"
                    placeholderTextColor="#8e8e93"
                    value={formData.carbs}
                    onChangeText={(text) => setFormData(prev => ({ ...prev, carbs: text }))}
                    keyboardType="numeric"
                  />
                </View>
                <View style={styles.nutritionField}>
                  <Text style={styles.nutritionFieldLabel}>Fat (g)</Text>
                  <TextInput
                    style={styles.nutritionFieldInput}
                    placeholder="0"
                    placeholderTextColor="#8e8e93"
                    value={formData.fat}
                    onChangeText={(text) => setFormData(prev => ({ ...prev, fat: text }))}
                    keyboardType="numeric"
                  />
                </View>
              </View>

              <Text style={styles.sectionLabel}>Category</Text>
              <View style={styles.categoryGrid}>
                {categories.map((cat) => (
                  <TouchableOpacity
                    key={cat.id}
                    style={[
                      styles.categoryOption,
                      formData.category === cat.id && styles.categoryOptionActive,
                    ]}
                    onPress={() => setFormData(prev => ({ ...prev, category: cat.id }))}
                  >
                    <Ionicons name={cat.icon as any} size={20} color={formData.category === cat.id ? '#D4A757' : cat.color} />
                    <Text style={[styles.categoryOptionText, formData.category === cat.id && styles.categoryOptionTextActive]}>
                      {cat.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <View style={styles.switchRow}>
                <Text style={styles.switchLabel}>Featured / Popular</Text>
                <Switch
                  value={formData.popular}
                  onValueChange={(value) => setFormData(prev => ({ ...prev, popular: value }))}
                  trackColor={{ false: '#e5e5e7', true: '#D4A757' }}
                  thumbColor={formData.popular ? '#FFFFFF' : '#FFFFFF'}
                />
              </View>

              <View style={styles.modalButtons}>
                <Button
                  title="Cancel"
                  variant="ghost"
                  onPress={() => setShowModal(false)}
                />
                <Button
                  title={editingMeal ? 'Save Changes' : 'Add Meal'}
                  variant="gold"
                  onPress={handleSaveMeal}
                  loading={loading}
                />
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f7',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.xl,
    paddingTop: theme.spacing.xl,
    paddingBottom: theme.spacing.md,
    backgroundColor: '#ffffff',
  },
  title: {
    fontSize: theme.typography.sizes['3xl'],
    fontWeight: theme.typography.weights.bold,
    color: '#1d1d1f',
  },
  addButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#D4A757',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#D4A757',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  filterContainer: {
    paddingHorizontal: theme.spacing.xl,
    marginBottom: theme.spacing.md,
    backgroundColor: '#ffffff',
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: 24,
    backgroundColor: '#f5f5f7',
    marginRight: theme.spacing.sm,
    gap: 4,
  },
  filterChipActive: {
    backgroundColor: '#1d1d1f',
  },
  filterText: {
    fontSize: theme.typography.sizes.sm,
    color: '#6e6e73',
  },
  filterTextActive: {
    color: '#ffffff',
  },
  content: {
    padding: theme.spacing.xl,
    paddingTop: 0,
    backgroundColor: '#f5f5f7',
  },
  mealCard: {
    backgroundColor: '#ffffff',
    borderRadius: theme.spacing.lg,
    padding: theme.spacing.lg,
    marginBottom: theme.spacing.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: theme.spacing.md,
  },
  mealImage: {
    width: 60,
    height: 60,
    borderRadius: theme.spacing.md,
    marginRight: theme.spacing.md,
  },
  mealImagePlaceholder: {
    width: 60,
    height: 60,
    borderRadius: theme.spacing.md,
    backgroundColor: '#f5f5f7',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: theme.spacing.md,
  },
  mealInfo: {
    flex: 1,
  },
  mealName: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.semibold,
    color: '#1d1d1f',
    marginBottom: 4,
  },
  categoryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  categoryText: {
    fontSize: theme.typography.sizes.xs,
  },
  priceBadge: {
    backgroundColor: '#D4A75710',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 4,
    borderRadius: theme.spacing.md,
  },
  priceText: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.bold,
    color: '#D4A757',
  },
  nutritionRow: {
    flexDirection: 'row',
    backgroundColor: '#f5f5f7',
    borderRadius: theme.spacing.md,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.md,
  },
  nutritionItem: {
    flex: 1,
    alignItems: 'center',
  },
  nutritionValue: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.semibold,
    color: '#1d1d1f',
  },
  nutritionLabel: {
    fontSize: theme.typography.sizes.xs,
    color: '#8e8e93',
  },
  nutritionDivider: {
    width: 1,
    backgroundColor: '#e5e5e7',
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  statusText: {
    fontSize: theme.typography.sizes.sm,
    color: '#6e6e73',
  },
  popularBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#D4A75710',
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 4,
    borderRadius: theme.spacing.sm,
    gap: 4,
  },
  popularText: {
    fontSize: theme.typography.sizes.xs,
    color: '#D4A757',
    fontWeight: theme.typography.weights.semibold,
  },
  actionButtons: {
    flexDirection: 'row',
    gap: theme.spacing.md,
  },
  emptyState: {
    alignItems: 'center',
    padding: theme.spacing['3xl'],
    borderRadius: theme.spacing.lg,
    overflow: 'hidden',
  },
  emptyTitle: {
    fontSize: theme.typography.sizes.lg,
    fontWeight: theme.typography.weights.semibold,
    color: '#1d1d1f',
    marginTop: theme.spacing.md,
  },
  emptyText: {
    fontSize: theme.typography.sizes.sm,
    color: '#8e8e93',
    marginTop: theme.spacing.sm,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalCard: {
    width: '90%',
    maxHeight: '85%',
    backgroundColor: '#ffffff',
    borderRadius: theme.spacing.lg,
    padding: theme.spacing.xl,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing.lg,
  },
  modalTitle: {
    fontSize: theme.typography.sizes.xl,
    fontWeight: theme.typography.weights.bold,
    color: '#1d1d1f',
  },
  imageUpload: {
    width: '100%',
    height: 150,
    backgroundColor: '#f5f5f7',
    borderRadius: theme.spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.spacing.lg,
    borderWidth: 1,
    borderColor: '#e5e5e7',
    borderStyle: 'dashed',
  },
  uploadedImage: {
    width: '100%',
    height: '100%',
    borderRadius: theme.spacing.lg,
  },
  imageUploadText: {
    fontSize: theme.typography.sizes.sm,
    color: '#8e8e93',
    marginTop: theme.spacing.sm,
  },
  modalInput: {
    backgroundColor: '#f5f5f7',
    borderRadius: theme.spacing.md,
    padding: theme.spacing.md,
    fontSize: theme.typography.sizes.md,
    color: '#1d1d1f',
    marginBottom: theme.spacing.md,
  },
  sectionLabel: {
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.semibold,
    color: '#1d1d1f',
    marginBottom: theme.spacing.sm,
    marginTop: theme.spacing.sm,
  },
  nutritionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.md,
  },
  nutritionField: {
    flex: 1,
    minWidth: '45%',
  },
  nutritionFieldLabel: {
    fontSize: theme.typography.sizes.xs,
    color: '#8e8e93',
    marginBottom: 4,
  },
  nutritionFieldInput: {
    backgroundColor: '#f5f5f7',
    borderRadius: theme.spacing.md,
    padding: theme.spacing.md,
    fontSize: theme.typography.sizes.md,
    color: '#1d1d1f',
  },
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.md,
  },
  categoryOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.spacing.md,
    backgroundColor: '#f5f5f7',
    gap: 4,
  },
  categoryOptionActive: {
    backgroundColor: '#D4A75720',
    borderWidth: 1,
    borderColor: '#D4A757',
  },
  categoryOptionText: {
    fontSize: theme.typography.sizes.sm,
    color: '#6e6e73',
  },
  categoryOptionTextActive: {
    color: '#D4A757',
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing.lg,
  },
  switchLabel: {
    fontSize: theme.typography.sizes.sm,
    color: '#1d1d1f',
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
    marginTop: theme.spacing.md,
  },
});