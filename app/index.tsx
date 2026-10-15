import { AuthLoadingScreen } from '../src/components/navigation/RouteGate';

// The root layout redirects '/' to the signed-in user's home (or to login)
// once the session and role are known; nothing role-specific renders here.
export default function Index() {
  return <AuthLoadingScreen />;
}
