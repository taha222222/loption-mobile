import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import AsyncStorage from '@react-native-async-storage/async-storage';

const resources = {
  en: {
    translation: {
      // Auth
      "sign_in": "Sign In",
      "sign_up": "Sign Up",
      "sign_out": "Sign Out",
      "email": "Email",
      "password": "Password",
      "confirm_password": "Confirm Password",
      "create_account": "Create Account",
      "already_have_account": "Already have an account?",
      
      // Onboarding
      "welcome": "Welcome",
      "welcome_title": "Welcome to L'OPTION",
      "welcome_text": "Your journey to a healthier, better you starts here. Let's personalize your experience.",
      "continue": "Continue",
      "back": "Back",
      "complete": "Complete",
      "select_gender": "Select your gender",
      "man": "Man",
      "woman": "Woman",
      "whats_your_goal": "What's your goal?",
      "lose_fat": "Lose Fat",
      "gain_muscle": "Gain Muscle",
      "maintain": "Maintain",
      "healthy_lifestyle": "Healthy Lifestyle",
      "tell_us_about_your_body": "Tell us about your body",
      "weight": "Weight (kg)",
      "height": "Height (cm)",
      "age": "Age",
      "activity_level": "Activity Level",
      "choose_program": "Choose your program",
      "meals_only": "Meals Only",
      "coaching": "Coaching",
      "transformation": "Transformation",
      
      // Home
      "home": "Home",
      "menu": "Menu",
      "cart": "Cart",
      "orders": "Orders",
      "profile": "Profile",
      "daily_energy_target": "Daily Energy Target",
      "remaining": "remaining",
      "protein": "Protein",
      "carbs": "Carbs",
      "fats": "Fats",
      "recommended_for_you": "Recommended for You",
      "see_all": "See All",
      "my_plan": "MY PLAN",
      "reorder": "REORDER",
      "upgrade_plan": "UPGRADE PLAN",
      "day_streak": "DAY STREAK",
      "goal_progress": "Goal Progress",
      "exclusive_offers": "EXCLUSIVE OFFERS",
      "limited": "LIMITED",
      "add_to_order": "ADD TO ORDER",
      "view_all": "View All",
      "settings": "SETTINGS",
      "help_center": "Help Center",
      
      // Checkout
      "checkout": "Checkout",
      "delivery_address": "Delivery Address",
      "payment_method": "Payment Method",
      "cash_on_delivery": "Cash on Delivery",
      "credit_card": "Credit/Debit Card",
      "order_summary": "Order Summary",
      "subtotal": "Subtotal",
      "delivery_fee": "Delivery Fee",
      "total": "Total",
      "place_order": "Place Order",
      
      // Order Tracking
      "track_order": "Track Order",
      "confirmed": "Confirmed",
      "preparing": "Preparing",
      "on_the_way": "On The Way",
      "delivered": "Delivered",
      "estimated_delivery": "Estimated Delivery",
      "total_amount": "Total Amount",
      "back_to_orders": "Back to Orders",
      
      // Driver
      "driver_dashboard": "Driver Dashboard",
      "current_status": "Current Status",
      "go_online": "GO ONLINE",
      "go_offline": "GO OFFLINE",
      "online": "ONLINE",
      "offline": "OFFLINE",
      "active_delivery": "ACTIVE DELIVERY",
      "available_orders": "AVAILABLE ORDERS",
      "no_orders_available": "No orders available",
      "check_back_later": "Check back later",
      "accept": "ACCEPT",
      "todays_earnings": "Today's Earnings",
      "this_week": "This Week",
      "total_earned": "Total Earned",
      "view_details": "View Details",
      
      // Admin
      "overview": "Overview",
      "partners": "Partners",
      "earnings": "Earnings",
      "total_orders": "Total Orders",
      "total_revenue": "Total Revenue",
      "customers": "Customers",
      "drivers": "Drivers",
      "pending_orders": "Pending Orders",
      "quick_actions": "Quick Actions",
      "add_meal": "Add Meal",
      "view_orders": "View Orders",
      "add_driver": "Add Driver",
      "add_partner": "Add Partner",
      "recent_activity": "Recent Activity",
      "system_running": "System running normally",
      
      // Messages
      "error": "Error",
      "success": "Success",
      "loading": "Loading...",
      "cancel": "Cancel",
      "save": "Save",
      "edit": "Edit",
      "delete": "Delete",
    }
  },
  fr: {
    translation: {
      // Auth
      "sign_in": "Se connecter",
      "sign_up": "S'inscrire",
      "sign_out": "Se déconnecter",
      "email": "E-mail",
      "password": "Mot de passe",
      "confirm_password": "Confirmer le mot de passe",
      "create_account": "Créer un compte",
      "already_have_account": "Déjà un compte?",
      
      // Onboarding
      "welcome": "Bienvenue",
      "welcome_title": "Bienvenue à L'OPTION",
      "welcome_text": "Votre voyage vers une meilleure santé commence ici. Personnalisons votre expérience.",
      "continue": "Continuer",
      "back": "Retour",
      "complete": "Terminer",
      "select_gender": "Sélectionnez votre genre",
      "man": "Homme",
      "woman": "Femme",
      "whats_your_goal": "Quel est votre objectif?",
      "lose_fat": "Perdre du poids",
      "gain_muscle": "Gagner du muscle",
      "maintain": "Maintenir",
      "healthy_lifestyle": "Mode de vie sain",
      "tell_us_about_your_body": "Parlez-nous de votre corps",
      "weight": "Poids (kg)",
      "height": "Taille (cm)",
      "age": "Âge",
      "activity_level": "Niveau d'activité",
      "choose_program": "Choisissez votre programme",
      "meals_only": "Repas uniquement",
      "coaching": "Coaching",
      "transformation": "Transformation",
      
      // Home
      "home": "Accueil",
      "menu": "Menu",
      "cart": "Panier",
      "orders": "Commandes",
      "profile": "Profil",
      "daily_energy_target": "Objectif énergétique",
      "remaining": "restant",
      "protein": "Protéines",
      "carbs": "Glucides",
      "fats": "Lipides",
      "recommended_for_you": "Recommandé pour vous",
      "see_all": "Voir tout",
      "my_plan": "MON PLAN",
      "reorder": "RECOMMANDER",
      "upgrade_plan": "AMÉLIORER LE PLAN",
      "day_streak": "JOURS CONSÉCUTIFS",
      "goal_progress": "Progression",
      "exclusive_offers": "OFFRES EXCLUSIVES",
      "limited": "LIMITÉ",
      "add_to_order": "AJOUTER À LA COMMANDE",
      "view_all": "Voir tout",
      "settings": "PARAMÈTRES",
      "help_center": "Centre d'aide",
      
      // Checkout
      "checkout": "Commander",
      "delivery_address": "Adresse de livraison",
      "payment_method": "Mode de paiement",
      "cash_on_delivery": "Paiement à la livraison",
      "credit_card": "Carte bancaire",
      "order_summary": "Récapitulatif",
      "subtotal": "Sous-total",
      "delivery_fee": "Frais de livraison",
      "total": "Total",
      "place_order": "Passer la commande",
      
      // Order Tracking
      "track_order": "Suivre la commande",
      "confirmed": "Confirmée",
      "preparing": "Préparation",
      "on_the_way": "En route",
      "delivered": "Livrée",
      "estimated_delivery": "Livraison estimée",
      "total_amount": "Montant total",
      "back_to_orders": "Retour aux commandes",
      
      // Driver
      "driver_dashboard": "Tableau de bord",
      "current_status": "Statut actuel",
      "go_online": "SE CONNECTER",
      "go_offline": "SE DÉCONNECTER",
      "online": "EN LIGNE",
      "offline": "HORS LIGNE",
      "active_delivery": "LIVRAISON ACTIVE",
      "available_orders": "COMMANDES DISPONIBLES",
      "no_orders_available": "Aucune commande",
      "check_back_later": "Revenez plus tard",
      "accept": "ACCEPTER",
      "todays_earnings": "Gains du jour",
      "this_week": "Cette semaine",
      "total_earned": "Total gagné",
      "view_details": "Voir détails",
      
      // Admin
      "overview": "Aperçu",
      "partners": "Partenaires",
      "earnings": "Gains",
      "total_orders": "Total commandes",
      "total_revenue": "Chiffre d'affaires",
      "customers": "Clients",
      "drivers": "Chauffeurs",
      "pending_orders": "Commandes en attente",
      "quick_actions": "Actions rapides",
      "add_meal": "Ajouter un repas",
      "view_orders": "Voir commandes",
      "add_driver": "Ajouter chauffeur",
      "add_partner": "Ajouter partenaire",
      "recent_activity": "Activité récente",
      "system_running": "Système opérationnel",
      
      // Messages
      "error": "Erreur",
      "success": "Succès",
      "loading": "Chargement...",
      "cancel": "Annuler",
      "save": "Enregistrer",
      "edit": "Modifier",
      "delete": "Supprimer",
    }
  }
};

i18n.use(initReactI18next).init({
  resources,
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

export const changeLanguage = async (lang: 'en' | 'fr') => {
  await i18n.changeLanguage(lang);
  await AsyncStorage.setItem('app_language', lang);
};

export const loadLanguage = async () => {
  const saved = await AsyncStorage.getItem('app_language');
  if (saved === 'en' || saved === 'fr') {
    await i18n.changeLanguage(saved);
  }
};

export default i18n;