-- ============================================================
-- YourBooks Lite - NUCLEAR DATABASE REPAIR SCRIPT (v8)
-- GOAL: Eliminate all RLS recursion, stabilize onboarding,
--       ENSURE accounting logic, and RESTORE ALL 530+ UNITS.
-- ============================================================

-- ── 1. ENSURE ALL CORE TABLES EXIST ────────────────────────

-- UNITS
CREATE TABLE IF NOT EXISTS public.units_of_measure (
  code text PRIMARY KEY,
  name text NOT NULL,
  is_custom boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- ACCOUNTS
CREATE TABLE IF NOT EXISTS public.accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid REFERENCES businesses(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  account_type text NOT NULL CHECK (account_type IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
  parent_id uuid REFERENCES accounts(id),
  is_system boolean DEFAULT false,
  is_active boolean DEFAULT true,
  description text,
  created_at timestamptz DEFAULT now(),
  UNIQUE(business_id, code)
);

-- JOURNAL ENTRIES
CREATE TABLE IF NOT EXISTS public.journal_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid REFERENCES businesses(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES branches(id),
  entry_date date NOT NULL DEFAULT CURRENT_DATE,
  reference_type text,
  reference_id uuid,
  description text NOT NULL,
  is_auto boolean DEFAULT true,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now()
);

-- JOURNAL ENTRY LINES
CREATE TABLE IF NOT EXISTS public.journal_entry_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_entry_id uuid REFERENCES journal_entries(id) ON DELETE CASCADE,
  account_id uuid REFERENCES accounts(id),
  debit numeric(15,2) DEFAULT 0,
  credit numeric(15,2) DEFAULT 0,
  description text,
  created_at timestamptz DEFAULT now()
);

-- ── 2. CLEANUP OLD POLICIES ────────────────────────────────
DO $$ 
DECLARE r RECORD;
BEGIN
  FOR r IN (
    SELECT policyname, tablename 
    FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename IN (
      'profiles', 'businesses', 'branches', 'tax_rates', 'categories', 
      'subscriptions', 'accounts', 'journal_entries', 'journal_entry_lines',
      'units_of_measure', 'suppliers', 'customers', 'products'
    )
  ) LOOP
    EXECUTE 'DROP POLICY IF EXISTS ' || quote_ident(r.policyname) || ' ON ' || quote_ident(r.tablename);
  END LOOP;
END $$;

-- ── 3. METADATA SYNC TRIGGER ───────────────────────────────
CREATE OR REPLACE FUNCTION sync_profile_to_auth() RETURNS TRIGGER AS $$
BEGIN
  UPDATE auth.users 
  SET raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || 
    jsonb_build_object(
      'business_id', NEW.business_id,
      'role', NEW.role,
      'is_super_admin', coalesce(NEW.is_super_admin, false)
    )
  WHERE id = NEW.id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS tr_sync_profile ON public.profiles;
CREATE TRIGGER tr_sync_profile
AFTER INSERT OR UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION sync_profile_to_auth();

-- ── 4. NON-RECURSIVE RLS POLICIES ──────────────────────────

-- GLOBAL TABLES
ALTER TABLE public.units_of_measure ENABLE ROW LEVEL SECURITY;
CREATE POLICY "units_read" ON public.units_of_measure FOR SELECT USING (true);

-- PROFILES
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "p_self" ON public.profiles FOR SELECT USING (id = auth.uid());
CREATE POLICY "p_admin" ON public.profiles FOR ALL USING (
  (auth.jwt() -> 'user_metadata' ->> 'role' = 'admin' AND (auth.jwt() -> 'user_metadata' ->> 'business_id')::uuid = business_id)
  OR (auth.jwt() -> 'user_metadata' ->> 'is_super_admin')::boolean = true
);

-- BUSINESSES
ALTER TABLE public.businesses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "b_read" ON public.businesses FOR SELECT USING (
  id = (auth.jwt() -> 'user_metadata' ->> 'business_id')::uuid 
  OR id IN (SELECT business_id FROM public.profiles WHERE id = auth.uid())
  OR (auth.jwt() -> 'user_metadata' ->> 'is_super_admin')::boolean = true
);
CREATE POLICY "b_admin" ON public.businesses FOR UPDATE USING (
  (id = (auth.jwt() -> 'user_metadata' ->> 'business_id')::uuid AND auth.jwt() -> 'user_metadata' ->> 'role' = 'admin')
  OR (id IN (SELECT business_id FROM public.profiles WHERE id = auth.uid() AND role = 'admin'))
  OR (auth.jwt() -> 'user_metadata' ->> 'is_super_admin')::boolean = true
);

-- CORE BUSINESS TABLES
DO $$
DECLARE tbl text;
BEGIN
  FOR tbl IN SELECT unnest(ARRAY['branches', 'tax_rates', 'categories', 'suppliers', 'customers', 'products', 'accounts', 'journal_entries']) LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL USING (
      (business_id = (auth.jwt() -> ''user_metadata'' ->> ''business_id'')::uuid)
      OR (business_id IN (SELECT business_id FROM public.profiles WHERE id = auth.uid()))
      OR (auth.jwt() -> ''user_metadata'' ->> ''is_super_admin'')::boolean = true
    )', tbl || '_policy', tbl);
  END LOOP;
END $$;

-- JOURNAL ENTRY LINES
ALTER TABLE public.journal_entry_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lines_policy" ON public.journal_entry_lines FOR ALL USING (
  EXISTS (SELECT 1 FROM journal_entries WHERE id = journal_entry_id AND 
    (business_id = (auth.jwt() -> 'user_metadata' ->> 'business_id')::uuid 
     OR business_id IN (SELECT business_id FROM public.profiles WHERE id = auth.uid())))
  OR (auth.jwt() -> 'user_metadata' ->> 'is_super_admin')::boolean = true
);

-- ── 5. RESTORE ALL 530+ GLOBAL UNITS ───────────────────────
INSERT INTO public.units_of_measure (code, name)
SELECT DISTINCT ON (code) code, name
FROM (VALUES
('Box', 'Box'), ('Pair', 'Pair'), ('Yard', 'Yard'), ('Dozen', 'Dozen'), ('Per week', 'Per week'), 
('Per month', 'Per month'), ('Per annum', 'Per annum'), ('1UGX', '1UGX'), ('1USD', '1USD'), ('Stick', 'Stick'), 
('Litre', 'Litre'), ('Kg', 'Kg'), ('User per day of access', 'User per day of access'), ('Minute', 'Minute'), 
('1000sticks', '1000sticks'), ('50kgs', '50kgs'), ('-', '-'), ('g', 'g'), ('OT', 'Octabin'), ('OU', 'Container'), 
('P2', 'Pan'), ('PA', 'Packet'), ('PB', 'Pallet, box'), ('PC', 'Parcel'), ('PLT', 'Pallet_ modular_ collars 80cm x 100cms'), 
('PE', 'Pallet, modular,collars 80cm*120cms'), ('PF', 'Pen'), ('PG', 'Plate'), ('PH', 'Pitcher'), ('PI', 'Pipe'), 
('PJ', 'Punnet'), ('PK', 'Package'), ('PL', 'Pail'), ('PN', 'Plank'), ('PO', 'Pouch'), ('PP', 'Piece'), 
('PR', 'Receptable, plastic'), ('PT', 'Pot'), ('PU', 'Tray'), ('PV', 'Pipes, in bundle/bunch/truss'), ('PX', 'Pallet'), 
('PY', 'Plates, in bundle/bunch/truss'), ('PZ', 'Planks, in bundle/bunch/truss'), ('QA', 'Drum,steel,non-removable head'), 
('QB', 'Drum, steel, removable head'), ('QC', 'Drum,aluminium,non-removable head'), ('QD', 'Drum, aluminium, removable head'), 
('QF', 'Drum, plastic, non-removable head'), ('QG', 'Drum, plastic, removable head'), ('QH', 'Barrel, wooden, bung type'), 
('QJ', 'Barrel, wooden, removable head'), ('QK', 'Jerrican, steel, non-removable head'), ('QL', 'Jerrican, steel, removable head'), 
('QM', 'Jerrican,plastic,non-removable head'), ('QN', 'Jerrican, plastic, removable head'), ('QP', 'Box, wooden, natural wood, ordinary'), 
('QQ', 'Box,natural wood,with sift walls 5'), ('QR', 'Box, plastic, expanded'), ('QS', 'Box, plastic, solid'), ('RD', 'Rod'), 
('RG', 'Ring'), ('RJ', 'Rack, clothing hanger'), ('RK', 'Rack'), ('RL', 'Reel'), ('RO', 'Roll'), ('RT', 'Rednet'), 
('RZ', 'Rods, in bundle/bunch/truss'), ('SA', 'Sack'), ('SB', 'Slab'), ('SC', 'Crate, shallow'), ('SD', 'Spindle'), 
('SE', 'Sea-chest'), ('SH', 'Sachet'), ('SI', 'Skid'), ('SK', 'Case, skeleton'), ('SL', 'Slipsheet'), ('SM', 'Sheetmetal'), 
('SO', 'Spool'), ('SP', 'Sheet, plastic wrapping'), ('SS', 'Case'), ('ST', 'Sheet'), ('SU', 'Suitcase'), ('SV', 'Envelope'), 
('SW', 'Shrinkwrapped'), ('SX', 'Set'), ('SY', 'Sleeve'), ('SZ', 'Sheets, in bundle/bunch/truss'), ('T1', 'Tablet'), 
('TB', 'Tub'), ('TC', 'Tea-chest'), ('TD', 'Tube, collapsible'), ('TE', 'Tyre'), ('TG', 'Tank container'), ('TI', 'Tierce'), 
('TK', 'Tank, rectangular'), ('TL', 'Tub'), ('TN', 'Tin'), ('TO', 'Tun'), ('TR', 'Trunk'), ('TS', 'Truss'), ('TT', 'Bag'), 
('TU', 'Tube'), ('TV', 'Tube, with nozzle'), ('TW', 'Pallet'), ('TY', 'Tank, cylindrical'), ('TZ', 'Tubes, in bundle/bunch/truss'), 
('UC', 'Uncaged'), ('UN', 'Unit'), ('VA', 'Vat'), ('VEH', 'Vehicle'), ('VG', 'Bulk'), ('VI', 'Vial'), ('VK', 'Vanpack'), 
('VL', 'Bulk, liquid'), ('VN', 'Vehicle'), ('VO', 'Bulk,solid,large particles(nodules)'), ('VP', 'Vacuum-packed'), ('Metre', 'Metre'), 
('VQ', 'Bulk,liquefied gas(abnormal temp/pr'), ('VR', 'Bulk, solid, granular particles'), ('VS', 'Bulk'), ('VY', 'Bulk, solid, fine particles(powder)'), 
('WA', 'Intermediate bulk container'), ('WB', 'Wickerbottle'), ('WC', 'Intermediate bulk container,steel'), 
('WD', 'Intermediate bulk container,alumini'), ('WF', 'Intermediate bulk container,metal'), ('WG', 'Intermediate bulk cont,steel,pressu'), 
('WH', 'Inter bulk container,alumin,pressur'), ('WJ', 'Inter bulk container,metal,pressure'), ('WK', 'Interme bulk container,steel,liquid'), 
('WL', 'Inter bulk container,alumin liquid'), ('WM', 'Interm bulk container,metal,liquid'), ('WN', 'Int bulk cont,woven plastic,no coat'), 
('WP', 'Inter bulk cont,woven plastic,coate'), ('WQ', 'Inter bulk cont,woven plastic,liner'), ('WR', 'Inter bulk cont,woven plastic,coate'), 
('WS', 'Interm bulk container, plastic film'), ('WT', 'Inter bulk cont,textile no coat/lin'), ('WU', 'Inter bulk cont,natural wood,liner'), 
('WV', 'Inter bulk contain, textile, coated'), ('WW', 'Inter bulk conta,textile,with liner'), ('WX', 'Inter bulk cont,textile,coated/line'), 
('WY', 'Inter bulk cont,plywood,inner liner'), ('WZ', 'Interm bulk conta,reconsituted wood'), ('XA', 'Bag,woven plastic,without inner coa'), 
('XB', 'Bag,woven plastic, sift proof'), ('XC', 'Bag, woven plastic, water resistant'), ('XD', 'Bag, plastics film'), 
('XF', 'Bag, textile,without inner coat/lin'), ('XG', 'Bag, textile, sift proof'), ('XH', 'Bag, textile, water resistant'), 
('XJ', 'Bag, paper, multi-wall'), ('XK', 'Bag,paper,multi-wall,water resistan'), ('XX', 'SCT UN-IDENTIFIED'), 
('YA', 'Composte pack,plast recp steel drum'), ('YB', 'Composte pack,plast recp steel crat'), ('YC', 'Composte pack,plast recp alumi drum'), 
('YD', 'Composte pack,plast recp alum crate'), ('YF', 'Composte pack,plast recp wooden box'), ('YG', 'Composte pack,plast recp plywo drum'), 
('YH', 'Composte pack,plast recp plywo box'), ('YJ', 'Composte pack,plast recp fibre drum'), ('YK', 'Composte pack,plast recp fibreb box'), 
('YL', 'Composte pack,plast recp plast drum'), ('YM', 'Composte pack,plast recp plastc box'), ('YN', 'Composte pack,glass recp steel drum'), 
('YP', 'Composte pack,glass recp steel crat'), ('YQ', 'Composte pack,glass recp alumi drum'), ('YR', 'Composte pack,glass recp alum crate'), 
('YS', 'Composte pack,glass recp wooden box'), ('YT', 'Composte pack,glass recp plywo drum'), ('YV', 'Composte pack,glass recp wicker ham'), 
('YW', 'Composte pack,glass recp fibre drum'), ('YX', 'Composte pack,glass recp fibreb box'), ('YY', 'Composte pack,glas rec ex plas pack'), 
('YZ', 'Composte pack,glas rec so plas pack'), ('ZA', 'Interm bulk cont, paper, multi-wall'), ('ZB', 'Bag, large'), 
('ZC', 'Inter bulk cont,paper,water resista'), ('ZD', 'Int.bulk.cont,plast,struc equip sol'), ('ZF', 'Int.bulk.cont,plast,free standing'), 
('ZG', 'Int.bulk.cont,plast,struc equp pres'), ('ZH', 'Int.bulk.cont,plast,freestand,press'), ('ZJ', 'Int.bulk.cont,plast,struc equip liq'), 
('ZK', 'Int.bulk.cont,plast,freestand,liqui'), ('ZL', 'Int.bulk.cont,comp,rigid plast,soli'), ('ZM', 'Int.bulk.cont,comp,flexi plast,soli'), 
('ZN', 'Int.bulk.cont,comp,rigid plast,pres'), ('ZP', 'Int.bulk.cont,comp,flex plast,press'), ('ZQ', 'Int.bulk.cont,comp,rigid plast,liqu'), 
('ZR', 'Int.bulk.cont,comp,flex plast,liqui'), ('ZS', 'Intermediate bulk container S'), ('ZT', 'Intermediate bulk container T'), 
('ZU', 'Intermediate bulk container U'), ('ZV', 'Intermediate bulk container V'), ('ZW', 'Intermediate bulk container W'), 
('ZX', 'Intermediate bulk container X'), ('ZY', 'Intermediate bulk container Y'), ('ZZ', 'Mutually defined'), 
('AA', 'Intermediate bulk container A'), ('AB', 'Receptacle B'), ('AC', 'Receptacle C'), ('AD', 'Receptacle D'), ('AE', 'Aerosol'), 
('AF', 'Pallet F'), ('AG', 'Pallet G'), ('AH', 'Pallet H'), ('AI', 'Clamshell'), ('AJ', 'Cone'), ('AL', 'Ball'), 
('AM', 'Ampoule, non protected'), ('AP', 'Ampoule, protected'), ('AT', 'Atomizer'), ('AV', 'Capsule'), ('BA', 'Barrel'), 
('BB', 'Bobbin'), ('BC', 'Bottle crate / bottle rack'), ('BD', 'Board'), ('BE', 'Bundle'), ('BF', 'Ballon, non-protected'), 
('BG', 'Bag'), ('BH', 'Bunch'), ('BI', 'Bin'), ('BJ', 'Bucket'), ('BK', 'Basket'), ('BL', 'Bale, compressed'), ('BM', 'Basin 5'), 
('BN', 'Bale, non compressed'), ('BO', 'Bottle, non protected, cylindrical'), ('BP', 'Ballon, protected'), 
('BQ', 'Bottle, protected cylindrical'), ('BR', 'Bar'), ('BS', 'Bottle, non protected, bulbous'), ('BT', 'Bolt'), ('BU', 'Butt'), 
('BV', 'Bottle, protected bulbous'), ('BW', 'Box, for liquids'), ('BX', 'Box 21 to'), ('BY', 'Board, in bundle/bunch/truss'), 
('BZ', 'Bars, in bundle/bunch/truss'), ('CA', 'Can, rectangular'), ('CB', 'Crate, beer'), ('CC', 'Churn'), 
('CD', 'Can, with handle and spout'), ('CE', 'Creel'), ('CF', 'Coffer'), ('CG', 'Cage'), ('CH', 'Chest'), ('CI', 'Canister'), 
('CJ', 'Coffin'), ('CK', 'Cask'), ('CL', 'Coil'), ('CM', 'Card'), ('CN', 'Container,nes as transport equipmen'), 
('CO', 'Carboy, non-protected'), ('CP', 'Carboy, protected'), ('CQ', 'Cartridge'), ('CR', 'Crate'), ('CS', 'Case'), ('CT', 'Carton'), 
('CU', 'Cup'), ('CV', 'Cover'), ('CW', 'Cage, roll'), ('CX', 'Can, cylindrical'), ('CY', 'Cylinder'), ('CZ', 'Canvas'), 
('DA', 'Crate, multiple layer, plastic'), ('DB', 'Crate, multiple layer, wooden'), ('DC', 'Crate D'), 
('DG', 'Cage,commonwealth handlg equip pool'), ('DH', 'Box,commonwealth handlig equip pool'), ('DI', 'Drum, iron'), 
('DJ', 'Demijohn, non-protected'), ('DK', 'Crate, bulk, cardboard'), ('DL', 'Crate, bulk, plastic'), ('DM', 'Crate, bulk, wooden'), 
('DN', 'Dispenser'), ('DP', 'Demijohn, protected'), ('DR', 'Drum'), ('DS', 'Tray, one layer no cover,plastic'), 
('DT', 'Tray, one layer no cover, wooden'), ('DU', 'Tray, one layer no cover,polystyren'), ('DV', 'Tray, one layer no cover, cardboard'), 
('DW', 'Tray,two layers no cover,platic tra'), ('DX', 'Tray, two layers no cover, wooden'), ('DY', 'Tray, two layers no cover,cardboard'), 
('EC', 'Bag, plastic'), ('ED', 'Case, with pallet base'), ('EE', 'Case, with pallet base, wooden'), 
('EF', 'Case, with pallet base, cardboard'), ('EG', 'Case, with pallet base, plastic'), ('EH', 'Case, with pallet base, metal'), 
('EI', 'Case, isothermic'), ('EN', 'Envelope'), ('FB', 'Flexibag'), ('FC', 'Crate, friut'), ('FD', 'Crate, framed'), ('FE', 'Flexitank'), 
('FI', 'Firkin'), ('FL', 'Flask'), ('FO', 'Footlocker'), ('FP', 'Filmpack'), ('FR', 'Frame'), ('FT', 'Foodtainer'), ('FW', 'Cart'), 
('FX', 'Bag F'), ('GB', 'Bottle, gas'), ('GI', 'Girder'), ('GL', 'Container G'), ('GR', 'Receptable, glass'), ('GU', 'Tray G'), 
('GY', 'Bag G'), ('GZ', 'Girders, in bundle/bunch/truss'), ('HA', 'Basket, with handle, plastic'), 
('HB', 'Basket, with handle, wooden'), ('HC', 'Basket, with handle, cardboard'), ('HG', 'Hogshead'), ('HN', 'Hanger'), ('HR', 'Hamper'), 
('IA', 'Package, display, wooden'), ('IB', 'Package, display, cardboard'), ('IC', 'Package, display, plastic'), 
('ID', 'Package, display, metal'), ('IE', 'Package, show'), ('IF', 'Package, flow'), ('IG', 'Package, paper wrapped'), 
('IH', 'Drum, plastic'), ('IK', 'Package I'), ('IL', 'Tray I'), ('IN', 'Ingot'), ('IZ', 'Ingots, in bundle/bunch/truss'), ('JB', 'Bag J'), 
('JC', 'Jerrican, rectangular'), ('JG', 'Jug'), ('JR', 'Jar'), ('JT', 'Jute bag'), ('JY', 'Jerrican, cylindrical'), ('KG', 'Keg'), 
('KI', 'Kit'), ('LE', 'Luggage'), ('LG', 'Log'), ('LT', 'Lot'), ('LU', 'Lug'), ('LV', 'Liftvan'), ('LZ', 'Logs, in bundle/bunch/truss'), 
('MA', 'Crate M'), ('MB', 'Bag, multiply'), ('MC', 'Crate, milk'), ('ME', 'Container M'), ('MR', 'Receptable, metal'), 
('MS', 'Sack, multi-wall'), ('MT', 'Mat'), ('MW', 'Receptable, plastic wrapped'), ('MX', 'Matchbox'), ('NA', 'Not available'), 
('NE', 'Unpacked or unpackaged E'), ('NF', 'Unpacked or unpackaged F'), ('NG', 'Unpacked or unpackaged G'), ('NS', 'Nest'), 
('NT', 'Net'), ('NU', 'Net, tube, plastic'), ('NV', 'Net, tube, textile'), ('OA', 'Pallet OA'), ('OB', 'Pallet OB'), ('OC', 'Pallet OC'), 
('OD', 'Pallet OD'), ('OE', 'Pallet OE'), ('OF', 'Platform'), ('OK', 'Block'), ('APZ', 'Ounce gb, us (31,10348 g)'), 
('ASM', 'Alcoholic strength by mass'), ('ASV', 'Alcoholic strength by volume'), ('BFT', 'Board foot'), ('AGE', 'YEAR OF MANUFACTURE'), 
('CCP', 'ENGINE CAPACITY(c.c)'), ('BHX', 'Hundred boxes'), ('BLD', 'Dry barrel (115,627 dm3)'), 
('BLL', 'Barrel (petroleum) (158,987 dm3)'), ('BUA', 'Bushel (35,2391 dm3)'), ('BUI', 'Bushel (36,36874 dm3)'), ('CEN', 'Hundred'), 
('CGM', 'Centigram'), ('CLF', 'Hundred leaves'), ('CLT', 'Centilitre'), ('CMK', 'Square centimetre'), ('CMQ', 'Cubic centimetre'), 
('CMT', 'Centimetre'), ('CNP', 'Hundred packs'), ('CNT', 'Cental gb (45,359237 kg)'), ('CTM', 'Metric carat (200 mg = 2.10-4 kg)'), 
('CWA', 'Hundredweight us (45,3592 kg)'), ('CWI', 'Hundredweight gb (50,802345 kg)'), ('DLT', 'Decilitre'), 
('DMK', 'Square decimetre'), ('DMQ', 'Cubic decimetre'), ('DMT', 'Decimetre'), ('DPC', 'Dozen pieces'), ('DPR', 'Dozen pairs'), 
('DRA', 'Dram us (3,887935 g)'), ('DRI', 'Dram gb (l,771745 g)'), ('DRL', 'Dozen rolls'), ('DRM', 'Drachm gb (3,887935 g)'), 
('DTH', 'Hectokilogram'), ('DTN', 'Centner, metric (100 kg)'), ('DWT', 'Pennyweight gb, us (1,555174 g)'), ('DZN', 'Dozen'), 
('DZP', 'Dozen packs'), ('FOT', 'Foot (0,3048 m)'), ('FTK', 'Square foot'), ('FTQ', 'Cubic foot'), ('GGR', 'Great gross (12 gross)'), 
('GIA', 'Gill (11,8294 cm3)'), ('GII', 'Gill (0,142065 dm3)'), ('GLD', 'Dry gallon (4,404884 dm3)'), ('GLI', 'Gallon (4,546092 dm3)'), 
('GLL', 'Liquid gallon (3,7854l dm3)'), ('GRM', 'Gram'), ('GRN', 'Grain gb, us (64,798910 mg)'), ('GRO', 'Gross'), 
('GRT', 'Gross [register] ton'), ('HGM', 'Hectogram'), ('HIU', 'Hundred international units'), ('HLT', 'Hectolitre'), 
('HPA', 'Hectolitre of pure alcohol'), ('INH', 'Inch (25,4 mm)'), ('INK', 'Square inch'), ('INQ', 'Cubic inch'), ('KGM', 'Kilogram'), 
('KNI', 'Kilogram of nitrogen'), ('KNS', 'Kilogram of named substance'), ('KPH', 'Kilogram of caustic potash'), 
('KPO', 'Kilogram of potassium oxide'), ('KPP', 'Kilogram of phosphoric anhydride'), ('KSD', 'Kilogram of substance 90 % dry'), 
('KSH', 'Kilogram of caustic soda'), ('KUR', 'Kilogram of uranium'), ('LBR', 'Pound gb, us (0,45359237 kg)'), 
('LBT', 'Troy pound, us (373,242 g)'), ('LEF', 'Leaf'), ('LPA', 'Litre of pure alcohol'), ('LTN', 'Long ton gb, us (1,0160469 t)'), 
('LTR', 'Litre (1 dm3)'), ('MAL', 'Megalitre'), ('MAM', 'Megametre'), ('MBF', 'Thousand board feet (2,36 m3)'), ('MGM', 'Milligram'), 
('MIL', 'Thousand'), ('MTK', 'Square metre'), ('MTQ', 'Cubic metre'), ('MTR', 'Metre'), ('NAR', 'Number of articles'), 
('NBB', 'Number of bobbins'), ('NIU', 'Number of international units'), ('NMB', 'Number'), ('NMP', 'Number of packs'), 
('NPL', 'Number of parcels'), ('NPR', 'Number of pairs'), ('NPT', 'Number of parts'), ('NRL', 'Number of rolls'), 
('NTT', 'Net [register] ton'), ('ONZ', 'Ounce gb, us (28,349523 g)'), ('OZA', 'Fluid ounce (29,5735 cm3)'), 
('OZI', 'Fluid ounce (28,4l3 cm3)'), ('PCE', 'Piece'), ('PGL', 'Proof gallon'), ('PTD', 'Dry pint (0,55061 dm3)'), 
('PTI', 'Pint (0,568262 dm3)'), ('PTL', 'Liquid pint (0,473l76 dm3)'), ('QTD', 'Dry quart (1,101221 dm3)'), ('QTI', 'Quart (1,136523 dm3)'), 
('QTL', 'Liquid quart (0,946353 dm3)'), ('QRT', 'Quarter_ gb -12.700586 kg'), ('SET', 'Set'), ('SHT', 'Shipping ton'), 
('STI', 'Stone gb (6,350293 kg)'), ('STN', 'Short ton gb, us (0,90718474 t)'), ('TNE', 'Metric ton (1000 kg)'), ('TPR', 'Ten pairs'), 
('TSD', 'Tonne of substance 90 per cent dry'), ('WCD', 'Cord  3-63 m3'), ('YDK', 'Square yard'), ('YDQ', 'Cubic yard'), 
('YRD', 'Yard 0-9144 m'), ('Per quarter', 'Per quarter'), ('Per Trip', 'Per Trip'), ('4H', 'Box 4H'), ('kW', 'kW'), ('B4', 'Belt'), 
('8A', 'Pallet 8A'), ('MW', 'MW'), ('5M', 'Bag 5M'), ('Per person', 'Per person'), ('Per day', 'Per day'), ('1F', 'Container 1F'), 
('2C', 'Barrel 2C'), ('Cycle', 'Cycle'), ('4C', 'Box 4C'), ('1G', 'Drum 1G'), ('KWh', 'Kilo Watt Hour'), ('Time of use', 'Time of use'), 
('4F', 'Box 4F'), ('Core', 'Core'), ('4B', 'Box 4B'), ('44', 'Bag 44'), ('Manhours', 'Manhours'), ('KM', 'Kilometres'), 
('3A', 'Jerrican 3A'), ('Hours', 'Hours'), ('7A', 'Case 7A'), ('1W', 'Drum 1W'), ('Cost', 'Cost'), ('8C', 'Bundle'), 
('MWh', 'Mega Watt Hour'), ('3H', 'Jerrican 3H'), ('Percentage', 'Percentage'), ('1A', 'Drum 1A'), ('Tot', 'Tot'), ('Ream', 'Ream'), 
('5L', 'Bag 5L'), ('Billing', 'Billing'), ('4G', 'Box 4G'), ('Straw', 'Straw'), ('7B', 'Case 7B'), ('Head', 'Head'), ('8B', 'Crate'), 
('1D', 'Drum 1D'), ('Per Shift', 'Per Shift'), ('5H', 'Bag 5H'), ('4A', 'Box 4A'), ('6H', 'Composite packaging 6H'), 
('1B', 'Drum 1B'), ('4D', 'Box 4D'), ('6P', 'Composite packaging 6P'), ('43', 'Bag 43')
) AS t(code, name)
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name;

-- ── 6. SEED CHART OF ACCOUNTS FUNCTION ─────────────────────
CREATE OR REPLACE FUNCTION seed_chart_of_accounts(p_business_id UUID)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.accounts (business_id, code, name, account_type, is_system, description) VALUES
    (p_business_id, '1000', 'Cash', 'asset', true, 'Cash on hand'),
    (p_business_id, '1010', 'Mobile Money', 'asset', true, 'MTN MoMo, Airtel Money'),
    (p_business_id, '1020', 'Bank Account', 'asset', true, 'Business bank account'),
    (p_business_id, '1100', 'Accounts Receivable', 'asset', true, 'Money owed by customers'),
    (p_business_id, '1200', 'Inventory', 'asset', true, 'Stock on hand'),
    (p_business_id, '1400', 'VAT Input', 'asset', true, 'VAT paid on purchases'),
    (p_business_id, '1300', 'Equipment', 'asset', true, 'Furniture, POS machines'),
    (p_business_id, '2000', 'Accounts Payable', 'liability', true, 'Money owed to suppliers'),
    (p_business_id, '2100', 'VAT Payable', 'liability', true, 'VAT collected on sales'),
    (p_business_id, '2200', 'Salaries Payable', 'liability', true, 'Employee wages owed'),
    (p_business_id, '3000', 'Owner Equity', 'equity', true, 'Initial capital'),
    (p_business_id, '3100', 'Retained Earnings', 'equity', true, 'Accumulated profit/loss'),
    (p_business_id, '4000', 'Sales Revenue', 'revenue', true, 'Revenue from product sales'),
    (p_business_id, '4100', 'Sales Discount', 'revenue', true, 'Discounts given to customers'),
    (p_business_id, '4200', 'Sales Returns', 'revenue', true, 'Credit notes / returns'),
    (p_business_id, '4300', 'Other Income', 'revenue', true, 'Miscellaneous income'),
    (p_business_id, '5000', 'COGS', 'expense', true, 'Cost of Goods Sold'),
    (p_business_id, '5100', 'Purchase Expense', 'expense', true, 'Purchases of supplies'),
    (p_business_id, '6000', 'Rent', 'expense', true, 'Shop / premises rent'),
    (p_business_id, '6050', 'Salaries & Wages', 'expense', true, 'Employee payroll')
  ON CONFLICT (business_id, code) DO NOTHING;
END;
$$;

-- ── 7. RESILIENT SETUP RPC ─────────────────────────────────
CREATE OR REPLACE FUNCTION setup_new_account(
  p_user_id uuid, p_full_name text, p_business_name text, p_country text, p_currency text
) RETURNS void AS $$
DECLARE v_biz_id uuid; v_branch_id uuid; v_plan_id uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN RETURN; END IF;

  INSERT INTO public.businesses (name, country, default_currency, subscription_status, subscription_ends_at)
  VALUES (p_business_name, p_country, p_currency, 'trial', now() + interval '30 days') 
  RETURNING id INTO v_biz_id;

  INSERT INTO public.branches (business_id, name) VALUES (v_biz_id, 'Main Branch') RETURNING id INTO v_branch_id;

  INSERT INTO public.profiles (id, business_id, branch_id, full_name, role, sales_type, is_active) 
  VALUES (p_user_id, v_biz_id, v_branch_id, p_full_name, 'admin', 'both', true);

  SELECT id INTO v_plan_id FROM public.subscription_plans WHERE name = 'free_trial' LIMIT 1;
  IF v_plan_id IS NOT NULL THEN
    INSERT INTO public.subscriptions (business_id, plan_id, status, current_period_end) VALUES (v_biz_id, v_plan_id, 'trial', now() + interval '30 days');
  END IF;

  PERFORM seed_chart_of_accounts(v_biz_id);
  INSERT INTO public.tax_rates (business_id, name, code, rate, is_default) VALUES (v_biz_id, 'VAT 18%', '01', 0.18, true) ON CONFLICT DO NOTHING;
  INSERT INTO public.categories (business_id, name) VALUES (v_biz_id, 'General') ON CONFLICT DO NOTHING;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── 8. INDEXES ─────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_accounts_business ON public.accounts(business_id);
CREATE INDEX IF NOT EXISTS idx_journal_entries_business ON public.journal_entries(business_id);
CREATE INDEX IF NOT EXISTS idx_journal_lines_entry ON public.journal_entry_lines(journal_entry_id);
