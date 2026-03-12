import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Text, View } from '@/components/Themed';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useRouter, useLocalSearchParams } from 'expo-router';
import {
  registerProduct as efrisRegisterProduct,
  EFRIS_UNIT_MAP,
  EFRIS_UNITS,
  EFRIS_TAX_CATEGORIES,
  type EfrisConfig,
} from '@/lib/efris';

type Category = { id: string; name: string };

export default function ProductFormScreen() {
  const { business, currentBranch, fmt, currency } = useAuth();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';

  const [name, setName] = useState('');
  const [barcode, setBarcode] = useState('');
  const [sku, setSku] = useState('');
  const [description, setDescription] = useState('');
  const [unit, setUnit] = useState('101');
  const [isService, setIsService] = useState(false);
  const [sellingPrice, setSellingPrice] = useState('');
  const [costPrice, setCostPrice] = useState('');
  const [quantity, setQuantity] = useState('0');
  const [reorderLevel, setReorderLevel] = useState('5');
  const [categoryId, setCategoryId] = useState('');
  const [categories, setCategories] = useState<Category[]>([]);
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const [saving, setSaving] = useState(false);

  // EFRIS state
  const [productId, setProductId] = useState<string | null>(null);
  const [commodityCode, setCommodityCode] = useState('');
  const [taxCategoryCode, setTaxCategoryCode] = useState('01');
  const [efrisProductCode, setEfrisProductCode] = useState<string | null>(null);
  const [efrisRegisteredAt, setEfrisRegisteredAt] = useState<string | null>(null);
  const [efrisRegistering, setEfrisRegistering] = useState(false);
  const efrisEnabled = business?.is_efris_enabled ?? false;

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.5,
    });
    if (!result.canceled) setImageUri(result.assets[0].uri);
  };

  const takePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Permission needed', 'Camera permission is required to take photos'); return; }
    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.5,
    });
    if (!result.canceled) setImageUri(result.assets[0].uri);
  };

  const uploadImage = async (productId: string): Promise<string | null> => {
    if (!imageUri || imageUri.startsWith('http')) return imageUri; // already uploaded
    try {
      const ext = imageUri.split('.').pop() || 'jpg';
      const fileName = `${productId}.${ext}`;
      const response = await fetch(imageUri);
      const blob = await response.blob();
      const arrayBuffer = await new Response(blob).arrayBuffer();
      const { error } = await supabase.storage
        .from('product-images')
        .upload(fileName, arrayBuffer, { contentType: `image/${ext}`, upsert: true });
      if (error) { console.log('Upload error:', error.message); return null; }
      const { data: urlData } = supabase.storage.from('product-images').getPublicUrl(fileName);
      return urlData.publicUrl;
    } catch (e: any) {
      console.log('Image upload failed:', e.message);
      return null;
    }
  };

  useEffect(() => {
    loadCategories();
    if (!isNew && id) loadProduct(id);
  }, [id]);

  const loadCategories = async () => {
    if (!business) return;
    const { data } = await supabase
      .from('categories')
      .select('id, name')
      .eq('business_id', business.id)
      .order('name');
    if (data) setCategories(data);
  };

  const loadProduct = async (productId: string) => {
    const { data } = await supabase
      .from('products')
      .select(`
        *,
        inventory!inner(selling_price, avg_cost_price, quantity, reorder_level)
      `)
      .eq('id', productId)
      .eq('inventory.branch_id', currentBranch?.id)
      .single();

    if (data) {
      setName(data.name);
      setBarcode(data.barcode || '');
      setSku(data.sku || data.commodity_code || '');
      setDescription(data.description || '');
      setUnit(data.unit || '101');
      setIsService(data.is_service ?? false);
      setCategoryId(data.category_id || '');
      if (data.image_url) setImageUri(data.image_url);
      // EFRIS fields
      setProductId(data.id);
      setCommodityCode(data.commodity_code || '');
      setTaxCategoryCode(data.tax_category_code || '01');
      setEfrisProductCode(data.efris_product_code || null);
      setEfrisRegisteredAt(data.efris_registered_at || null);
      const inv = (data as any).inventory?.[0];
      if (inv) {
        setSellingPrice(inv.selling_price?.toString() || '');
        setCostPrice(inv.avg_cost_price?.toString() || '');
        setQuantity(inv.quantity?.toString() || '0');
        setReorderLevel(inv.reorder_level?.toString() || '5');
      }
    }
  };

  const handleSave = async () => {
    if (!name.trim()) {
      Alert.alert('Error', 'Product name is required');
      return;
    }
    if (!sellingPrice || isNaN(Number(sellingPrice))) {
      Alert.alert('Error', 'Please enter a valid selling price');
      return;
    }
    if (!business || !currentBranch) return;

    setSaving(true);
    try {
      if (isNew) {
        // Create product
        const { data: product, error: productError } = await supabase
          .from('products')
          .insert({
            business_id: business.id,
            category_id: categoryId || null,
            name: name.trim(),
            barcode: barcode.trim() || null,
            sku: sku.trim() || null,
            description: description.trim() || null,
            unit,
            is_service: isService,
            commodity_code: sku.trim() || null,
            tax_category_code: taxCategoryCode,
          })
          .select()
          .single();

        if (productError) throw productError;

        // Upload image if selected
        const imageUrl = await uploadImage(product.id);
        if (imageUrl) {
          await supabase.from('products').update({ image_url: imageUrl }).eq('id', product.id);
        }

        // Create inventory record for this branch
        const { error: invError } = await supabase
          .from('inventory')
          .insert({
            branch_id: currentBranch.id,
            product_id: product.id,
            quantity: parseInt(quantity) || 0,
            avg_cost_price: parseFloat(costPrice) || 0,
            selling_price: parseFloat(sellingPrice),
            reorder_level: parseInt(reorderLevel) || 5,
          });

        if (invError) throw invError;

        Alert.alert('Success', 'Product added successfully!', [
          { text: 'Add Another', onPress: () => resetForm() },
          { text: 'Done', onPress: () => router.back() },
        ]);
      } else {
        // Upload image if changed
        const imageUrl = await uploadImage(id!);

        // Update product
        const { error: productError } = await supabase
          .from('products')
          .update({
            category_id: categoryId || null,
            name: name.trim(),
            barcode: barcode.trim() || null,
            sku: sku.trim() || null,
            description: description.trim() || null,
            unit,
            image_url: imageUrl,
            is_service: isService,
            commodity_code: sku.trim() || null,
            tax_category_code: taxCategoryCode,
          })
          .eq('id', id);

        if (productError) throw productError;

        // Update inventory
        const { error: invError } = await supabase
          .from('inventory')
          .update({
            selling_price: parseFloat(sellingPrice),
            reorder_level: parseInt(reorderLevel) || 5,
          })
          .eq('product_id', id)
          .eq('branch_id', currentBranch.id);

        if (invError) throw invError;

        Alert.alert('Success', 'Product updated!');
        router.back();
      }
    } catch (error: any) {
      Alert.alert('Error', error.message);
    } finally {
      setSaving(false);
    }
  };

  const resetForm = () => {
    setName(''); setBarcode(''); setSku(''); setDescription('');
    setUnit('101'); setIsService(false); setSellingPrice(''); setCostPrice('');
    setQuantity('0'); setReorderLevel('5'); setCategoryId(''); setImageUri(null);
    setCommodityCode(''); setTaxCategoryCode('01');
    setEfrisProductCode(null); setEfrisRegisteredAt(null); setProductId(null);
  };

  // EFRIS: Register product
  const handleEfrisRegister = async () => {
    if (!business || !sku.trim()) { Alert.alert('Missing info', 'Enter an SKU / commodity code first'); return; }
    if (!business.efris_api_key) {
      Alert.alert('EFRIS not configured', 'Go to Settings → EFRIS Configuration and add your API key.'); return;
    }
    if (!name.trim() || !sellingPrice) { Alert.alert('Error', 'Save the product first (name and price required)'); return; }
    const theId = productId || id;
    if (!theId || theId === 'new') { Alert.alert('Save First', 'Please save the product before registering with EFRIS.'); return; }

    setEfrisRegistering(true);
    try {
      const config: EfrisConfig = {
        apiKey: business.efris_api_key,
        apiUrl: business.efris_api_url || '',
        testMode: business.efris_test_mode ?? true,
      };
      const unitCode = EFRIS_UNIT_MAP[unit] || '101';
      const efrisItemCode = description.trim() || name.trim();
      const result = await efrisRegisterProduct(config, {
        item_code: efrisItemCode,
        item_name: name.trim(),
        unit_price: sellingPrice,
        commodity_code: sku.trim(),
        unit_of_measure: unitCode,
        stock_prewarning: reorderLevel || '0',
        description: description.trim() || undefined,
        ...(isService ? { is_service: true } : {}),
      });
      if (result.success && result.product_code) {
        const now = new Date().toISOString();
        await supabase.from('products').update({
          efris_product_code: result.product_code,
          efris_item_code: efrisItemCode,
          efris_registered_at: now,
          is_service: isService,
        }).eq('id', theId);
        setEfrisProductCode(result.product_code);
        setEfrisRegisteredAt(now);
        Alert.alert('✅ Registered', `Product registered with EFRIS.\nCode: ${result.product_code}`);
      } else {
        Alert.alert('EFRIS Error', result.error || 'Registration failed. Try again.');
      }
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setEfrisRegistering(false);
    }
  };

  // Save product AND register with EFRIS in one action
  const handleSaveAndRegister = async () => {
    if (!name.trim()) { Alert.alert('Error', 'Product name is required'); return; }
    if (!sellingPrice || isNaN(Number(sellingPrice))) { Alert.alert('Error', 'Please enter a valid selling price'); return; }
    if (!sku.trim()) { Alert.alert('Missing info', 'Enter an SKU / commodity code first'); return; }
    if (!business?.efris_api_key) { Alert.alert('EFRIS not configured', 'Go to Settings → EFRIS Configuration and add your API key.'); return; }
    if (!business || !currentBranch) return;

    setSaving(true);
    setEfrisRegistering(true);
    try {
      let theId: string;

      if (isNew) {
        const { data: product, error: productError } = await supabase
          .from('products')
          .insert({
            business_id: business.id,
            category_id: categoryId || null,
            name: name.trim(),
            barcode: barcode.trim() || null,
            sku: sku.trim() || null,
            description: description.trim() || null,
            unit,
            is_service: isService,
            commodity_code: sku.trim() || null,
            tax_category_code: taxCategoryCode,
          })
          .select()
          .single();
        if (productError) throw productError;
        const imageUrl = await uploadImage(product.id);
        if (imageUrl) await supabase.from('products').update({ image_url: imageUrl }).eq('id', product.id);
        await supabase.from('inventory').insert({
          branch_id: currentBranch.id,
          product_id: product.id,
          quantity: parseInt(quantity) || 0,
          avg_cost_price: parseFloat(costPrice) || 0,
          selling_price: parseFloat(sellingPrice),
          reorder_level: parseInt(reorderLevel) || 5,
        });
        theId = product.id;
        setProductId(product.id);
      } else {
        const imageUrl = await uploadImage(id!);
        const { error: productError } = await supabase.from('products').update({
          category_id: categoryId || null,
          name: name.trim(),
          barcode: barcode.trim() || null,
          sku: sku.trim() || null,
          description: description.trim() || null,
          unit,
          image_url: imageUrl,
          is_service: isService,
          commodity_code: sku.trim() || null,
          tax_category_code: taxCategoryCode,
        }).eq('id', id);
        if (productError) throw productError;
        await supabase.from('inventory').update({
          selling_price: parseFloat(sellingPrice),
          reorder_level: parseInt(reorderLevel) || 5,
        }).eq('product_id', id).eq('branch_id', currentBranch.id);
        theId = id!;
      }

      // Now register with EFRIS
      const config: EfrisConfig = {
        apiKey: business.efris_api_key,
        apiUrl: business.efris_api_url || '',
        testMode: business.efris_test_mode ?? true,
      };
      const unitCode = EFRIS_UNIT_MAP[unit] || '101';
      const efrisItemCode = description.trim() || name.trim();
      const result = await efrisRegisterProduct(config, {
        item_code: efrisItemCode,
        item_name: name.trim(),
        unit_price: sellingPrice,
        commodity_code: sku.trim(),
        unit_of_measure: unitCode,
        stock_prewarning: reorderLevel || '0',
        description: description.trim() || undefined,
        ...(isService ? { is_service: true } : {}),
      });

      if (result.success && result.product_code) {
        const now = new Date().toISOString();
        await supabase.from('products').update({
          efris_product_code: result.product_code,
          efris_item_code: efrisItemCode,
          efris_registered_at: now,
        }).eq('id', theId);
        setEfrisProductCode(result.product_code);
        setEfrisRegisteredAt(now);
        if (isNew) {
          Alert.alert('✅ Product Added & Registered', `Saved and registered with EFRIS.\nCode: ${result.product_code}`, [
            { text: 'Add Another', onPress: () => resetForm() },
            { text: 'Done', onPress: () => router.back() },
          ]);
        } else {
          Alert.alert('✅ Saved & Registered', `Changes saved.\nEFRIS Code: ${result.product_code}`);
          router.back();
        }
      } else {
        const saved = isNew ? 'Product added' : 'Changes saved';
        Alert.alert(`${saved} ⚠️`, `${saved} but EFRIS registration failed: ${result.error || 'Unknown error'}`);
        if (!isNew) router.back();
        else {
          Alert.alert('', '', [
            { text: 'Add Another', onPress: () => resetForm() },
            { text: 'Done', onPress: () => router.back() },
          ]);
        }
      }
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setSaving(false);
      setEfrisRegistering(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
    <View style={styles.container}>
      {scanning ? (
        <View style={styles.scannerContainer}>
          <CameraView
            style={styles.camera}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'code128', 'code39', 'qr'] }}
            onBarcodeScanned={({ data }) => {
              setBarcode(data);
              setScanning(false);
            }}
          />
          <TouchableOpacity style={styles.closeScan} onPress={() => setScanning(false)}>
            <FontAwesome name="times" size={22} color="#fff" />
            <Text style={{ color: '#fff', marginLeft: 8 }}>Cancel</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {/* Product Image */}
          <View style={styles.imageSection}>
            {imageUri ? (
              <TouchableOpacity onPress={pickImage}>
                <Image source={{ uri: imageUri }} style={styles.productImage} />
                <View style={styles.imageEditBadge}>
                  <FontAwesome name="pencil" size={12} color="#fff" />
                </View>
              </TouchableOpacity>
            ) : (
              <View style={styles.imagePlaceholder}>
                <FontAwesome name="image" size={40} color="#555" />
                <Text style={styles.imagePlaceholderText}>Add Product Photo</Text>
              </View>
            )}
            <View style={styles.imageButtons}>
              <TouchableOpacity style={styles.imageBtn} onPress={takePhoto}>
                <FontAwesome name="camera" size={16} color="#fff" />
                <Text style={styles.imageBtnText}>Take Photo</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.imageBtn} onPress={pickImage}>
                <FontAwesome name="photo" size={16} color="#fff" />
                <Text style={styles.imageBtnText}>From Gallery</Text>
              </TouchableOpacity>
            </View>
          </View>

          <Text style={styles.groupLabel}>ITEM TYPE & DETAILS</Text>

          {/* Product vs Service Toggle */}
          <View style={styles.field}>
            <Text style={styles.label}>Type *</Text>
            <View style={styles.chipRow}>
              <TouchableOpacity
                style={[styles.chip, !isService && styles.chipActive]}
                onPress={() => setIsService(false)}
              >
                <Text style={[styles.chipText, !isService && styles.chipTextActive]}>📦 Product</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.chip, isService && styles.chipActive]}
                onPress={() => setIsService(true)}
              >
                <Text style={[styles.chipText, isService && styles.chipTextActive]}>🔧 Service</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.hint}>{efrisEnabled ? (isService ? 'Services use empty goodsTypeCode for EFRIS.' : 'Products use goodsTypeCode "101" for EFRIS.') : (isService ? 'Service — no physical stock tracking.' : 'Physical product with stock tracking.')}</Text>
          </View>

          {/* Name */}
          <View style={styles.field}>
            <Text style={styles.label}>Product Name *</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Timberland Boot Size 42"
              placeholderTextColor="#555"
              value={name}
              onChangeText={setName}
            />
          </View>

          {/* Barcode */}
          <View style={styles.field}>
            <Text style={styles.label}>Barcode / QR Code (Optional)</Text>
            <Text style={styles.hint}>Leave empty for items without barcodes — you can sell them by name search</Text>
            <View style={styles.inputRow}>
              <TextInput
                style={[styles.input, styles.inputFlex]}
                placeholder="Scan or type barcode (or leave empty)"
                placeholderTextColor="#555"
                value={barcode}
                onChangeText={setBarcode}
              />
              <TouchableOpacity
                style={styles.scanButton}
                onPress={() => {
                  if (!permission?.granted) requestPermission();
                  else setScanning(true);
                }}
              >
                <FontAwesome name="camera" size={20} color="#fff" />
              </TouchableOpacity>
            </View>
          </View>

          {/* SKU / Commodity Code */}
          <View style={styles.field}>
            <Text style={styles.label}>{efrisEnabled ? 'SKU / Commodity Code' : 'SKU / Product Code'}</Text>
            <Text style={styles.hint}>{efrisEnabled ? 'Product identifier. For EFRIS, use the 8-digit UNBS commodity code.' : 'Optional product identifier or code.'}</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. 84713000"
              placeholderTextColor="#555"
              value={sku}
              onChangeText={setSku}
            />
          </View>

          {/* Unit of Measure — all 9 EFRIS codes */}
          <View style={styles.field}>
            <Text style={styles.label}>Unit of Measure</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.chipRow}>
                {EFRIS_UNITS.map((u) => (
                  <TouchableOpacity
                    key={u.code}
                    style={[styles.chip, unit === u.code && styles.chipActive]}
                    onPress={() => setUnit(u.code)}
                  >
                    <Text style={[styles.chipText, unit === u.code && styles.chipTextActive]}>{u.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
          </View>

          {/* Category */}
          {categories.length > 0 && (
            <View style={styles.field}>
              <Text style={styles.label}>Category</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={styles.chipRow}>
                  {categories.map((c) => (
                    <TouchableOpacity
                      key={c.id}
                      style={[styles.chip, categoryId === c.id && styles.chipActive]}
                      onPress={() => setCategoryId(c.id)}
                    >
                      <Text style={[styles.chipText, categoryId === c.id && styles.chipTextActive]}>{c.name}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
            </View>
          )}

          <Text style={styles.groupLabel}>PRICING & STOCK</Text>

          {/* Selling Price */}
          <View style={styles.field}>
            <Text style={styles.label}>Selling Price ({currency.symbol}) *</Text>
            <TextInput
              style={styles.input}
              placeholder="0"
              placeholderTextColor="#555"
              value={sellingPrice}
              onChangeText={setSellingPrice}
              keyboardType="numeric"
            />
          </View>

          {/* Cost Price */}
          <View style={styles.field}>
            <Text style={styles.label}>Cost Price ({currency.symbol})</Text>
            <TextInput
              style={styles.input}
              placeholder="0"
              placeholderTextColor="#555"
              value={costPrice}
              onChangeText={setCostPrice}
              keyboardType="numeric"
            />
          </View>

          {/* Initial Quantity (new products only) */}
          {isNew && (
            <View style={styles.field}>
              <Text style={styles.label}>Opening Stock Quantity</Text>
              <TextInput
                style={styles.input}
                placeholder="0"
                placeholderTextColor="#555"
                value={quantity}
                onChangeText={setQuantity}
                keyboardType="numeric"
              />
            </View>
          )}

          {/* Reorder Level */}
          <View style={styles.field}>
            <Text style={styles.label}>Low Stock Alert (min qty)</Text>
            <TextInput
              style={styles.input}
              placeholder="5"
              placeholderTextColor="#555"
              value={reorderLevel}
              onChangeText={setReorderLevel}
              keyboardType="numeric"
            />
          </View>

          {/* Description */}
          <View style={styles.field}>
            <Text style={styles.label}>Description (Optional)</Text>
            <TextInput
              style={[styles.input, styles.textarea]}
              placeholder="Additional details about this product..."
              placeholderTextColor="#555"
              value={description}
              onChangeText={setDescription}
              multiline
              numberOfLines={3}
            />
          </View>

          {/* Save Button(s) */}
          {efrisEnabled ? (
            <View style={styles.twoButtonRow}>
              <TouchableOpacity
                style={[styles.saveButton, { flex: 1, marginBottom: 0 }, saving && { opacity: 0.6 }]}
                onPress={handleSave}
                disabled={saving}
              >
                {saving ? <ActivityIndicator color="#fff" /> : (
                  <Text style={styles.saveButtonText}>{isNew ? '+ Add' : '💾 Save Changes'}</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.efrisRegisterBtn, { flex: 1, marginBottom: 0 }, (saving || efrisRegistering) && { opacity: 0.6 }]}
                onPress={handleSaveAndRegister}
                disabled={saving || efrisRegistering}
              >
                {(saving || efrisRegistering) ? <ActivityIndicator color="#fff" size="small" /> : (
                  <Text style={styles.efrisRegisterText}>Register with EFRIS</Text>
                )}
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              style={[styles.saveButton, saving && { opacity: 0.6 }]}
              onPress={handleSave}
              disabled={saving}
            >
              {saving ? <ActivityIndicator color="#fff" /> : (
                <Text style={styles.saveButtonText}>{isNew ? '+ Add' : '💾 Save Changes'}</Text>
              )}
            </TouchableOpacity>
          )}

          {/* EFRIS Section (only when enabled) */}
          {efrisEnabled && (
            <>
              <Text style={[styles.groupLabel, { color: '#7C3AED' }]}>🇺🇬 EFRIS TAX REGISTRATION</Text>

              {/* EFRIS Status Badge */}
              <View style={[styles.efrisBadge, efrisProductCode ? styles.efrisBadgeOk : styles.efrisBadgePending]}>
                <FontAwesome name={efrisProductCode ? 'check-circle' : 'exclamation-circle'} size={16} color={efrisProductCode ? '#4CAF50' : '#ff9800'} />
                <Text style={styles.efrisBadgeText}>
                  {efrisProductCode
                    ? `Registered — ${efrisProductCode}`
                    : 'Not registered with EFRIS'}
                </Text>
              </View>

              {/* Tax Category */}
              <View style={styles.field}>
                <Text style={styles.label}>Default Tax Category</Text>
                <Text style={styles.hint}>Sets the default tax rate when selling this product. Can be changed per sale.</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={styles.chipRow}>
                    {EFRIS_TAX_CATEGORIES.filter(tc => ['01','02','03'].includes(tc.code)).map((tc) => (
                      <TouchableOpacity
                        key={tc.code}
                        style={[styles.chip, taxCategoryCode === tc.code && styles.efrisChipActive]}
                        onPress={() => setTaxCategoryCode(tc.code)}
                      >
                        <Text style={[styles.chipText, taxCategoryCode === tc.code && styles.chipTextActive]}>{tc.label}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </ScrollView>
              </View>

              {/* Register Button is now integrated into the Save & Register button above */}
              {efrisProductCode && !isNew && (
                <TouchableOpacity
                  style={[styles.efrisRegisterBtn, { marginTop: 8 }, efrisRegistering && { opacity: 0.6 }]}
                  onPress={handleEfrisRegister}
                  disabled={efrisRegistering}
                >
                  {efrisRegistering ? <ActivityIndicator color="#fff" size="small" /> : (
                    <Text style={styles.efrisRegisterText}>Re-register with EFRIS</Text>
                  )}
                </TouchableOpacity>
              )}
            </>
          )}

        </ScrollView>
      )}
    </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  scrollContent: { padding: 16 },
  imageSection: { alignItems: 'center', marginBottom: 20, backgroundColor: 'transparent' },
  productImage: { width: 120, height: 120, borderRadius: 16, borderWidth: 2, borderColor: '#0f3460' },
  imageEditBadge: { position: 'absolute', bottom: 4, right: 4, backgroundColor: '#e94560', width: 28, height: 28, borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
  imagePlaceholder: { width: 120, height: 120, borderRadius: 16, backgroundColor: '#16213e', borderWidth: 2, borderColor: '#0f3460', borderStyle: 'dashed', justifyContent: 'center', alignItems: 'center' },
  imagePlaceholderText: { color: '#555', fontSize: 11, marginTop: 6 },
  imageButtons: { flexDirection: 'row', gap: 12, marginTop: 10 },
  imageBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#0f3460', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20 },
  imageBtnText: { color: '#aaa', fontSize: 12 },
  groupLabel: { fontSize: 11, color: '#666', fontWeight: 'bold', letterSpacing: 1, marginBottom: 12, marginTop: 8 },
  field: { marginBottom: 16 },
  label: { fontSize: 13, color: '#aaa', marginBottom: 6 },
  hint: { fontSize: 12, color: '#555', marginBottom: 8, fontStyle: 'italic' },
  input: {
    backgroundColor: '#16213e',
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
    color: '#fff',
    borderWidth: 1,
    borderColor: '#0f3460',
  },
  inputFlex: { flex: 1 },
  inputRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  textarea: { height: 90, textAlignVertical: 'top' },
  scanButton: {
    backgroundColor: '#0f3460',
    width: 50,
    height: 50,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  chipRow: { flexDirection: 'row', gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#16213e',
    borderWidth: 1,
    borderColor: '#0f3460',
  },
  chipActive: { backgroundColor: '#e94560', borderColor: '#e94560' },
  chipText: { color: '#aaa', fontSize: 13 },
  chipTextActive: { color: '#fff', fontWeight: 'bold' },
  saveButton: {
    backgroundColor: '#e94560',
    borderRadius: 14,
    padding: 18,
    alignItems: 'center',
    marginTop: 16,
    marginBottom: 32,
  },
  twoButtonRow: { flexDirection: 'row', gap: 10, marginTop: 16, marginBottom: 32 },
  saveButtonText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  scannerContainer: { flex: 1 },
  camera: { flex: 1 },
  closeScan: {
    position: 'absolute',
    bottom: 40,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 30,
  },
  // EFRIS styles
  efrisBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 10,
    marginBottom: 16,
  },
  efrisBadgeOk: { backgroundColor: '#1b3d1b' },
  efrisBadgePending: { backgroundColor: '#3d3020' },
  efrisBadgeText: { color: '#ddd', fontSize: 13, flex: 1 },
  commodityPicker: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#16213e',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#7C3AED44',
  },
  commodityPickerValue: { flex: 1, color: '#fff', fontSize: 14 },
  commodityPickerPlaceholder: { flex: 1, color: '#666', fontSize: 14 },
  efrisChipActive: { backgroundColor: '#7C3AED', borderColor: '#7C3AED' },
  efrisRegisterBtn: {
    backgroundColor: '#7C3AED',
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
    marginBottom: 32,
  },
  efrisRegisterText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  commodityModal: {
    backgroundColor: '#1a1a2e',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '80%',
    padding: 16,
  },
  commodityModalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  commodityModalTitle: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  commoditySearchInput: {
    backgroundColor: '#16213e',
    borderRadius: 10,
    padding: 12,
    color: '#fff',
    fontSize: 15,
    borderWidth: 1,
    borderColor: '#0f3460',
    marginBottom: 8,
  },
  commodityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#0f3460',
  },
  commodityRowCode: { color: '#7C3AED', fontWeight: 'bold', fontSize: 13, width: 90 },
  commodityRowName: { flex: 1, color: '#ddd', fontSize: 14 },
});
