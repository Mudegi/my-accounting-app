import React from 'react';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/lib/auth';

function TabBarIcon(props: {
  name: React.ComponentProps<typeof FontAwesome>['name'];
  color: string;
}) {
  return <FontAwesome size={22} style={{ marginBottom: -3 }} {...props} />;
}

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const { profile } = useAuth();

  // Field-only salespersons can't do normal POS sales or manage inventory
  const isFieldOnly = profile?.role === 'salesperson' && profile?.sales_type === 'field';

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: '#e94560',
        tabBarInactiveTintColor: '#555',
        tabBarStyle: {
          backgroundColor: '#16213e',
          borderTopColor: '#0f3460',
          height: 60 + insets.bottom,
          paddingBottom: insets.bottom + 4,
        },
        headerStyle: { backgroundColor: '#1a1a2e' },
        headerTintColor: '#fff',
        headerTitleStyle: { fontWeight: 'bold' },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: isFieldOnly ? 'Field Sale' : 'Sell',
          tabBarIcon: ({ color }) => <TabBarIcon name="shopping-cart" color={color} />,
        }}
      />
      <Tabs.Screen
        name="inventory"
        options={{
          title: isFieldOnly ? 'My Stock' : 'Inventory',
          tabBarIcon: ({ color }) => <TabBarIcon name="cube" color={color} />,
        }}
      />
      <Tabs.Screen
        name="two"
        options={{
          title: 'Dashboard',
          tabBarIcon: ({ color }) => <TabBarIcon name="bar-chart" color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color }) => <TabBarIcon name="cog" color={color} />,
        }}
      />
    </Tabs>
  );
}
