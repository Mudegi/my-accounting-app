import { Stack } from 'expo-router';

export default function FieldSalesLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: '#1a1a2e' },
        headerTintColor: '#fff',
        headerTitleStyle: { fontWeight: 'bold' },
      }}
    >
      {/* Sell is the "home" screen — no back button, no swipe-back */}
      <Stack.Screen
        name="sell"
        options={{
          title: 'Field Sale',
          headerBackVisible: false,
          gestureEnabled: false,
        }}
      />
      <Stack.Screen name="my-stock" options={{ title: 'My Assigned Stock' }} />
      <Stack.Screen name="field-customers" options={{ title: 'Field Customers' }} />
      <Stack.Screen name="reconciliation" options={{ title: 'Reconciliation' }} />
      <Stack.Screen name="assign-stock" options={{ title: 'Assign Stock' }} />
      <Stack.Screen name="approve-sales" options={{ title: 'Approve Field Sales' }} />
    </Stack>
  );
}
