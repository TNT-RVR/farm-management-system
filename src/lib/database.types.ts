// Hand-written to mirror supabase/migrations (gen types requires Docker or a
// personal access token; regenerate with `npx supabase gen types typescript
// --project-id your-project-ref` once a PAT is configured). Keep in sync
// with every migration.
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

type UserRole = 'admin' | 'manager' | 'user'
type BoundarySource = 'kml' | 'drawn' | 'jd_import' | 'fah_import' | 'file_import'
type LayerType = 'boundary' | 'utility' | 'pipeline' | 'pivot' | 'well' | 'custom'
type FieldFileKind = 'soil_test' | 'fertility_map' | 'rx' | 'photo' | 'doc'
type YieldUnit = 'bu' | 'lbs' | 'cwt' | 'ton' | 'MT' | 'ac'
type HistorySource = 'manual' | 'fah_import' | 'jd_import' | 'rotation_xlsx' | 'scale'
type BinPolicy = 'mixable' | 'segregate_by_field' | 'segregate_by_variety'
/** What the crop is grown for, which is what the farm actually sorts by. */
type CropCategory = 'seed' | 'commercial' | 'own_use'
type InputCategory = 'seed' | 'fert' | 'chem' | 'fuel' | 'custom' | 'other'
type TaskStatus = 'open' | 'done'
type TaskSource =
  | 'manual'
  | 'checklist'
  | 'monthly'
  | 'voice'
  | 'irrigation'
  | 'hail'
  | 'river'
  | 'grant'
  | 'equipment'
type GrantStatus =
  | 'new'
  | 'reviewing'
  | 'applying'
  | 'submitted'
  | 'awarded'
  | 'declined'
  | 'ignored'
  // Set automatically once the deadline passes. Distinct from 'ignored',
  // which is a decision we made rather than the calendar making it.
  | 'closed'
type ChecklistCategory = 'irrigation' | 'equipment' | 'fields' | 'cattle' | 'other'
type RunStatus = 'open' | 'done'
type EventKind = 'general' | 'field_work' | 'meeting' | 'maintenance' | 'delivery' | 'other'
type RecurrenceType = 'annual' | 'multi_per_year' | 'one_time'
type ContactType = 'buyer' | 'supplier' | 'agronomist' | 'custom_operator' | 'trucking' | 'other'
type ContractStatus = 'open' | 'partial' | 'delivered' | 'cancelled'
type FinancialKind = 'expense' | 'revenue'
type CattleSex = 'bull' | 'cow' | 'steer' | 'heifer' | 'calf'
type CattleStatus = 'active' | 'sold' | 'died' | 'culled'
type CattleEventType =
  | 'calving'
  | 'vaccination'
  | 'treatment'
  | 'weight'
  | 'movement'
  | 'breeding'
  | 'preg_check'
  | 'weaning'
  | 'branding'
  | 'sale'
  | 'death'
  | 'other'
type GrainMovementType =
  'harvest_in' | 'transfer_in' | 'transfer_out' | 'delivery_out' | 'shrink' | 'adjustment'
type InputMovementType = 'purchase' | 'use' | 'adjustment'
/** What a browser has to do with the camera's URL to show a picture. */
type CameraKind = 'snapshot' | 'mjpeg' | 'hls' | 'embed'

export type Database = {
  public: {
    Tables: {
      /** Daily weather per station (ACIS, Open-Meteo, ECCC, FieldNET). Written by the irrigation sync. */
      weather_daily: {
        Row: {
          precip_prob: number | null
          station_id: string
          date: string
          tmax_c: number | null
          tmin_c: number | null
          rh_max: number | null
          rh_min: number | null
          rh_mean: number | null
          tdew_c: number | null
          wind_ms: number | null
          wind_height_m: number | null
          solar_mj: number | null
          precip_mm: number | null
          et0_mm: number | null
          source: string
          updated_at: string
        }
        Insert: never
        Update: never
        Relationships: []
      }
      /** Products a fertilizer blend can be made from (Fertilizer → Blends). Fractions; P is P2O5, K is K2O. */
      fert_blend_products: {
        Row: { id: string; name: string; n: number; p: number; k: number; s: number; zn: number; price_per_tonne: number | null; price_note: string | null; density_lb_ft3: number | null; active: boolean; sort_order: number; updated_at: string }
        Insert: { id?: string; name: string; n?: number; p?: number; k?: number; s?: number; zn?: number; price_per_tonne?: number | null; price_note?: string | null; density_lb_ft3?: number | null; active?: boolean; sort_order?: number; updated_at?: string }
        Update: Partial<Database['public']['Tables']['fert_blend_products']['Insert']>
        Relationships: []
      }
      /** A blend somebody built and saved. */
      fert_blends: {
        Row: { id: string; name: string; field_id: string | null; crop_year: number | null; acres: number | null; targets: Json; lines: Json; cost_per_ac: number | null; rate_lb_ac: number | null; advice: string | null; notes: string | null; created_by: string | null; created_at: string }
        Insert: { id?: string; name: string; field_id?: string | null; crop_year?: number | null; acres?: number | null; targets: Json; lines: Json; cost_per_ac?: number | null; rate_lb_ac?: number | null; advice?: string | null; notes?: string | null; created_by?: string | null; created_at?: string }
        Update: Partial<Database['public']['Tables']['fert_blends']['Insert']>
        Relationships: []
      }
      /** A whole field farmed by somebody else in a given year. */
      field_year_tenure: {
        Row: { id: string; field_id: string; crop_year: number; rented_to: string | null; note: string | null; created_at: string }
        Insert: { id?: string; field_id: string; crop_year: number; rented_to?: string | null; note?: string | null }
        Update: Partial<Database['public']['Tables']['field_year_tenure']['Insert']>
        Relationships: []
      }
      /** Most acres of a crop in a year; crop_year null = every year. */
      crop_acre_limits: {
        Row: { id: string; crop_id: string | null; crop_group: 'dry_bean' | 'canola' | 'forage_legume' | null; crop_year: number | null; max_acres: number; notes: string | null; updated_at: string }
        Insert: { id?: string; crop_id?: string | null; crop_group?: 'dry_bean' | 'canola' | 'forage_legume' | null; crop_year?: number | null; max_acres: number; notes?: string | null }
        Update: Partial<Database['public']['Tables']['crop_acre_limits']['Insert']>
        Relationships: []
      }
      /** Heat units, frost-free days and the seasonal outlook per 0.25° weather cell (season-outlook-background). */
      field_climate: {
        Row: {
          cell_key: string
          lat: number
          lon: number
          years_from: number | null
          years_to: number | null
          chu_median: number | null
          chu_p20: number | null
          chu_p80: number | null
          ffd_median: number | null
          spring_frost_median: string | null
          fall_frost_median: string | null
          season_precip_mm_median: number | null
          outlook: Json | null
          outlook_at: string | null
          computed_at: string
        }
        Insert: Partial<Database['public']['Tables']['field_climate']['Row']> & { cell_key: string; lat: number; lon: number }
        Update: Partial<Database['public']['Tables']['field_climate']['Row']>
        Relationships: []
      }
      /** Reservoir storage, headwater snowpack and SMRID notices (season-outlook-background). */
      water_supply: {
        Row: {
          id: string
          kind: 'reservoir' | 'snow' | 'notice'
          station: string
          name: string
          feeds: string | null
          observed_on: string
          value: number | null
          unit: string | null
          pct_full: number | null
          pct_full_last_year: number | null
          pct_of_median: number | null
          url: string | null
          fetched_at: string
        }
        Insert: Partial<Database['public']['Tables']['water_supply']['Row']> & { kind: 'reservoir' | 'snow' | 'notice'; station: string; name: string; observed_on: string }
        Update: Partial<Database['public']['Tables']['water_supply']['Row']>
        Relationships: []
      }
      /** Rotation → recommendations: each request and the advice the background job wrote back. */
      rotation_advice: {
        Row: {
          id: string
          crop_year: number
          requested_by: string | null
          status: 'pending' | 'done' | 'error'
          request: string
          request_hash: string
          advice: string | null
          error: string | null
          model: string | null
          created_at: string
          finished_at: string | null
        }
        Insert: Partial<Database['public']['Tables']['rotation_advice']['Row']> & { crop_year: number; request: string; request_hash: string }
        Update: Partial<Database['public']['Tables']['rotation_advice']['Row']>
        Relationships: []
      }
      /** What a product's label says may be planted after it (read by Claude from the label text). */
      chemical_recrop_rules: {
        Row: { id: string; registration_number: string; following_crop: string; crop_key: string | null; months: number | null; status: 'ok' | 'wait' | 'second_season' | 'bioassay' | 'not_listed' | 'do_not'; condition: string | null; quote: string | null; source: string; extracted_at: string }
        Insert: { id?: string; registration_number: string; following_crop: string; crop_key?: string | null; months?: number | null; status: 'ok' | 'wait' | 'second_season' | 'bioassay' | 'not_listed' | 'do_not'; condition?: string | null; quote?: string | null; source?: string }
        Update: Partial<Database['public']['Tables']['chemical_recrop_rules']['Insert']>
        Relationships: []
      }
      /** Grazing / feeding / slaughter / dairy intervals read off each label (src/lib/grazing-restrictions.ts). */
      chemical_grazing_rules: {
        Row: { id: string; registration_number: string; crop: string | null; crop_key: string | null; kind: 'graze' | 'feed' | 'slaughter' | 'dairy'; days: number | null; never: boolean; condition: string | null; quote: string | null; source: 'label' | 'manual'; extracted_at: string }
        Insert: { id?: string; registration_number: string; crop?: string | null; crop_key?: string | null; kind: 'graze' | 'feed' | 'slaughter' | 'dairy'; days?: number | null; never?: boolean; condition?: string | null; quote?: string | null; source?: 'label' | 'manual' }
        Update: Partial<Database['public']['Tables']['chemical_grazing_rules']['Insert']>
        Relationships: []
      }
      /** A spray on a pasture, written down by hand (Deere records crop fields only). */
      pasture_sprays: {
        Row: { id: string; pasture_id: string; applied_on: string; product: string; registration_number: string | null; notes: string | null; created_by: string | null; created_at: string }
        Insert: { id?: string; pasture_id: string; applied_on: string; product: string; registration_number?: string | null; notes?: string | null }
        Update: Partial<Database['public']['Tables']['pasture_sprays']['Insert']>
        Relationships: []
      }
      /** Sprays and grazing clashes already told to the managers (the grazing watch's memory). */
      grazing_restriction_alerts: {
        Row: { id: string; alert_key: string; kind: 'spray' | 'conflict'; field_id: string | null; pasture_id: string | null; registration_number: string | null; applied_on: string | null; restricted_until: string | null; created_at: string }
        Insert: { id?: string; alert_key: string; kind: 'spray' | 'conflict'; field_id?: string | null; pasture_id?: string | null; registration_number?: string | null; applied_on?: string | null; restricted_until?: string | null }
        Update: Partial<Database['public']['Tables']['grazing_restriction_alerts']['Insert']>
        Relationships: []
      }
      /** A water district's allotment for a year (SMRID sets one each spring). */
      /** Rain at a field from ECCC's radar-and-gauge analyses (RDPA 10 km, HRDPA 2.5 km), local day. */
      field_rain_daily: {
        Row: { field_id: string; date: string; rdpa_mm: number | null; hrdpa_mm: number | null; updated_at: string }
        Insert: { field_id: string; date: string; rdpa_mm?: number | null; hrdpa_mm?: number | null; updated_at?: string }
        Update: Partial<Database['public']['Tables']['field_rain_daily']['Insert']>
        Relationships: []
      }
      /** The farm's own rain gauges (AIMM precipitation gauges); fields link through fields.rain_gauge_id. */
      rain_gauges: {
        Row: { id: string; name: string; latitude: number | null; longitude: number | null; active: boolean; created_by: string | null; created_at: string }
        Insert: { id?: string; name: string; latitude?: number | null; longitude?: number | null; active?: boolean; created_by?: string | null; created_at?: string }
        Update: Partial<Database['public']['Tables']['rain_gauges']['Insert']>
        Relationships: []
      }
      /** One reading a day per gauge, mm. */
      rain_gauge_readings: {
        Row: { id: string; gauge_id: string; date: string; mm: number; note: string | null; created_by: string | null; created_at: string }
        Insert: { id?: string; gauge_id: string; date: string; mm: number; note?: string | null; created_by?: string | null; created_at?: string }
        Update: Partial<Database['public']['Tables']['rain_gauge_readings']['Insert']>
        Relationships: []
      }
      /** FieldNET water for one pivot and local day, per 1-degree bearing (bins[0] = north, clockwise). */
      fieldnet_applied_bins: {
        Row: { fieldnet_id: string; field_id: string | null; date: string; bins: number[]; mean_mm: number; covered_deg: number; arc_deg: number; updated_at: string }
        Insert: { fieldnet_id: string; field_id?: string | null; date: string; bins: number[]; mean_mm: number; covered_deg: number; arc_deg: number; updated_at?: string }
        Update: Partial<Database['public']['Tables']['fieldnet_applied_bins']['Insert']>
        Relationships: []
      }
      /** A pivot pass from the controller history: where it ran and how it ended. */
      fieldnet_passes: {
        Row: {
          id: string
          fieldnet_id: string
          field_id: string | null
          started_at: string
          ended_at: string | null
          start_deg: number | null
          end_deg: number | null
          swept_deg: number | null
          direction: string | null
          depth_mm: number | null
          end_status: string | null
          completed: boolean | null
          updated_at: string
        }
        Insert: never
        Update: never
        Relationships: []
      }
      /** A measured soil moisture: plant-available water (mm) over the root zone. Corrects the AIMM line on its day. */
      soil_moisture_readings: {
        Row: { id: string; field_id: string; zone_id: string | null; read_on: string; avail_mm: number; pct_of_fc: number | null; method: 'hand_feel' | 'probe' | 'sensor' | 'lab' | 'aimm'; depth_note: string | null; note: string | null; created_by: string | null; created_at: string }
        Insert: { id?: string; field_id: string; zone_id?: string | null; read_on: string; avail_mm: number; pct_of_fc?: number | null; method?: 'hand_feel' | 'probe' | 'sensor' | 'lab' | 'aimm'; depth_note?: string | null; note?: string | null; created_by?: string | null; created_at?: string }
        Update: Partial<Database['public']['Tables']['soil_moisture_readings']['Insert']>
        Relationships: []
      }
      /** Soil moisture per 10-degree wedge of the pivot circle (index 0 = 0-10 deg from north, clockwise). */
      water_balance_wedges: {
        Row: { field_id: string; date: string; is_forecast: boolean; avail_mm: number[]; fc_mm: number[]; irr_mm: number[]; updated_at: string }
        Insert: never
        Update: never
        Relationships: []
      }
      /** AIMM long-term daily normals (TaberLTN, EastRanchLTN…). */
      weather_normals: {
        Row: { ltn_file: string; month: number; day: number; tmax_c: number | null; tmin_c: number | null; wind_km_d: number | null; precip_mm: number | null; rh_max: number | null; rh_min: number | null; solar_kj: number | null }
        Insert: never
        Update: never
        Relationships: []
      }
      /** AIMM's crop table (CropType.csv): Kc polynomial on GDD5 and root/depletion settings. */
      aimm_crops: {
        Row: { id: number; name: string; a: number | null; b: number | null; c: number | null; d: number | null; e: number | null; forage: boolean; max_root_m: number | null; allowable_depletion: number | null; root_transition_days: number | null; upper_share: number | null; lower_share: number | null; maturity_gdd: number | null }
        Insert: never
        Update: never
        Relationships: []
      }
      /** Per field, the rest of the season from today: maturity, last irrigation needed, water still to apply. */
      field_season_outlook: {
        Row: { field_id: string; crop_year: number; computed_on: string; gdd_to_date: number | null; maturity_gdd: number | null; maturity_on: string | null; last_irrigation_by: string | null; need_more_mm: number | null; passes_left: number | null; projected_season_in: number | null; note: string | null; updated_at: string }
        Insert: never
        Update: never
        Relationships: []
      }
      /** A check of what a pivot really applies (catch cans, flow meter) against what its panel says. */
      pivot_depth_checks: {
        Row: { id: string; fieldnet_id: string | null; field_id: string | null; checked_on: string; method: 'catch_can' | 'flow_meter' | 'pump_power' | 'other'; speed_pct: number | null; panel_mm: number | null; measured_mm: number; note: string | null; created_by: string | null; created_at: string }
        Insert: { id?: string; fieldnet_id?: string | null; field_id?: string | null; checked_on: string; method: 'catch_can' | 'flow_meter' | 'pump_power' | 'other'; speed_pct?: number | null; panel_mm?: number | null; measured_mm: number; note?: string | null; created_by?: string | null; created_at?: string }
        Update: Partial<Database['public']['Tables']['pivot_depth_checks']['Insert']>
        Relationships: []
      }
      water_allotments: {
        Row: { id: string; year: number; source: string; inches: number; contract_inches: number | null; note: string | null; updated_at: string; source_url: string | null; rate_per_acre: number | null; min_per_parcel: number | null; rate_note: string | null; rate_source_url: string | null }
        Insert: { id?: string; year: number; source?: string; inches: number; contract_inches?: number | null; note?: string | null; updated_at?: string; source_url?: string | null; rate_per_acre?: number | null; min_per_parcel?: number | null; rate_note?: string | null; rate_source_url?: string | null }
        Update: Partial<Database['public']['Tables']['water_allotments']['Insert']>
        Relationships: []
      }
      /** A stock count ('count' sets it) or correction ('adjust' adds) for a chemical, in its own unit. */
      chem_stock_adjustments: {
        Row: { id: string; product_id: string; kind: 'count' | 'adjust'; quantity: number; occurred_on: string; note: string | null; created_by: string | null; created_at: string }
        Insert: { id?: string; product_id: string; kind: 'count' | 'adjust'; quantity: number; occurred_on?: string; note?: string | null; created_by?: string | null; created_at?: string }
        Update: Partial<Database['public']['Tables']['chem_stock_adjustments']['Insert']>
        Relationships: []
      }
      /** A pin dropped while scouting: what was seen, how bad, where, with photos. */
      scouting_notes: {
        Row: {
          id: string
          field_id: string | null
          crop_year: number
          observed_at: string
          lat: number | null
          lng: number | null
          category: 'weed' | 'insect' | 'disease' | 'other'
          subject: string | null
          severity: number
          note: string | null
          photo_paths: string[]
          created_by: string | null
          resolved_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          field_id?: string | null
          crop_year?: number
          observed_at?: string
          lat?: number | null
          lng?: number | null
          category?: 'weed' | 'insect' | 'disease' | 'other'
          subject?: string | null
          severity?: number
          note?: string | null
          photo_paths?: string[]
          created_by?: string | null
          resolved_at?: string | null
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['scouting_notes']['Insert']>
        Relationships: []
      }
      /** Rented land: landlord, rent, term and the yearly rent dates. Managers only. */
      land_leases: {
        Row: {
          id: string
          landlord: string
          contact_id: string | null
          phone: string | null
          email: string | null
          field_ids: string[]
          legal_land: string | null
          acres: number | null
          rent_per_acre: number | null
          rent_total: number | null
          crop_share_pct: number | null
          start_date: string | null
          end_date: string | null
          notice_days: number
          /** [{ date: 'MM-DD', share: 0..1 }] */
          payment_schedule: Json
          notes: string | null
          active: boolean
          renewal_reminded_for: string | null
          created_at: string
          arrangement: 'cash_rent' | 'profit_share' | 'crop_share'
          our_share_pct: number | null
          inputs_shared: boolean
          owner_covers: string | null
          we_cover: string | null
          /** 'in' = land we rent from its owner; 'out' = our land a grower farms (landlord = the grower). */
          direction: 'in' | 'out'
          /** Crops the deal covers; null = every crop. */
          crop_ids: string[] | null
        }
        Insert: {
          id?: string
          landlord: string
          contact_id?: string | null
          phone?: string | null
          email?: string | null
          field_ids?: string[]
          legal_land?: string | null
          acres?: number | null
          rent_per_acre?: number | null
          rent_total?: number | null
          crop_share_pct?: number | null
          start_date?: string | null
          end_date?: string | null
          notice_days?: number
          payment_schedule?: Json
          notes?: string | null
          active?: boolean
          renewal_reminded_for?: string | null
          created_at?: string
          arrangement?: 'cash_rent' | 'profit_share' | 'crop_share'
          our_share_pct?: number | null
          inputs_shared?: boolean
          owner_covers?: string | null
          we_cover?: string | null
          direction?: 'in' | 'out'
          crop_ids?: string[] | null
        }
        Update: Partial<Database['public']['Tables']['land_leases']['Insert']>
        Relationships: []
      }
      land_lease_payments: {
        Row: {
          id: string
          lease_id: string
          due_on: string
          amount: number | null
          paid_on: string | null
          note: string | null
          reminded_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          lease_id: string
          due_on: string
          amount?: number | null
          paid_on?: string | null
          note?: string | null
          reminded_at?: string | null
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['land_lease_payments']['Insert']>
        Relationships: []
      }
      /** A strip given more N than the crop can use; its red-edge reading is "enough N" for its field. */
      n_rich_strips: {
        Row: {
          id: string
          field_id: string
          crop_year: number
          label: string | null
          geom: unknown
          extra_lb_n: number | null
          notes: string | null
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          field_id: string
          crop_year: number
          label?: string | null
          geom: unknown
          extra_lb_n?: number | null
          notes?: string | null
          created_by?: string | null
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['n_rich_strips']['Insert']>
        Relationships: []
      }
      /** An on-farm N-rate trial: randomised strips across a field, harvested strip by strip. */
      n_trials: {
        Row: {
          id: string
          field_id: string
          crop_year: number
          crop_id: string | null
          name: string | null
          rates: number[]
          reps: number
          layout: number[]
          base_rate: number | null
          strip_width_m: number
          heading_deg: number | null
          seed: number
          status: 'planned' | 'applied' | 'harvested'
          /** [{ strip, yield }] */
          results: Json
          yield_unit: string | null
          notes: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          field_id: string
          crop_year: number
          crop_id?: string | null
          name?: string | null
          rates: number[]
          reps?: number
          layout: number[]
          base_rate?: number | null
          strip_width_m?: number
          heading_deg?: number | null
          seed?: number
          status?: 'planned' | 'applied' | 'harvested'
          results?: Json
          yield_unit?: string | null
          notes?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['n_trials']['Insert']>
        Relationships: []
      }
      /** Sensor-cable readings down a bin, for BASF's canola storage report and any stored crop. */
      bin_monitor_readings: {
        Row: {
          id: string
          bin_id: string
          crop_year: number
          crop_id: string | null
          read_on: string
          lot_number: string | null
          lld: string | null
          initials: string | null
          /** [{ level (1 = top), temp_c, rh_pct, moisture_pct, moisture_from, air }] */
          levels: Json
          source: 'manual' | 'screenshot'
          notes: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          bin_id: string
          crop_year: number
          crop_id?: string | null
          read_on?: string
          lot_number?: string | null
          lld?: string | null
          initials?: string | null
          levels?: Json
          source?: 'manual' | 'screenshot'
          notes?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['bin_monitor_readings']['Insert']>
        Relationships: []
      }
      /** Where irrigation water is sampled, and which water each station stands for. */
      water_quality_stations: {
        Row: {
          station_id: string
          source: 'aepa' | 'idwq' | 'own'
          name: string
          water_source: 'oldman' | 'smrid' | null
          for_credit: boolean
          lat: number | null
          lon: number | null
          active: boolean
        }
        Insert: {
          station_id: string
          source: 'aepa' | 'idwq' | 'own'
          name: string
          water_source?: 'oldman' | 'smrid' | null
          for_credit?: boolean
          lat?: number | null
          lon?: number | null
          active?: boolean
        }
        Update: Partial<Database['public']['Tables']['water_quality_stations']['Insert']>
        Relationships: []
      }
      /** Irrigation water chemistry, pulled monthly from the province. */
      water_quality_samples: {
        Row: {
          id: string
          source: 'aepa' | 'idwq' | 'own'
          station_id: string
          sampled_at: string
          parameter: string
          value: number
          below_dl: boolean
          unit: string | null
          created_at: string
        }
        Insert: {
          id?: string
          source: 'aepa' | 'idwq' | 'own'
          station_id: string
          sampled_at: string
          parameter: string
          value: number
          below_dl?: boolean
          unit?: string | null
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['water_quality_samples']['Insert']>
        Relationships: []
      }
      /** Samples found over a water-quality guideline; a row means it has been notified. */
      water_quality_flags: {
        Row: {
          id: string
          station_id: string
          sampled_at: string
          parameter: string
          use: string
          value: number
          limit_value: number
          unit: string | null
          created_at: string
        }
        Insert: {
          id?: string
          station_id: string
          sampled_at: string
          parameter: string
          use: string
          value: number
          limit_value: number
          unit?: string | null
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['water_quality_flags']['Insert']>
        Relationships: []
      }
      /** A local buyer's bid, so basis can be measured against the board. */
      cash_bids: {
        Row: {
          id: string
          crop_id: string
          buyer: string
          bid_on: string
          price_per_unit: number
          unit: string
          delivery_month: string | null
          location: string | null
          series_id: string | null
          contract_month: string | null
          notes: string | null
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          crop_id: string
          buyer: string
          bid_on: string
          price_per_unit: number
          unit?: string
          delivery_month?: string | null
          location?: string | null
          series_id?: string | null
          contract_month?: string | null
          notes?: string | null
          created_by?: string | null
        }
        Update: {
          crop_id?: string
          buyer?: string
          bid_on?: string
          price_per_unit?: number
          unit?: string
          delivery_month?: string | null
          location?: string | null
          series_id?: string | null
          contract_month?: string | null
          notes?: string | null
        }
        Relationships: []
      }
      /** The price you would sell at: a fixed one, or a margin over cost. */
      marketing_targets: {
        Row: {
          id: string
          crop_id: string
          crop_year: number
          mode: 'absolute' | 'over_breakeven'
          value: number
          quantity: number | null
          series_id: string | null
          note: string | null
          active: boolean
          hit_at: string | null
          hit_value: number | null
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          crop_id: string
          crop_year: number
          mode: 'absolute' | 'over_breakeven'
          value: number
          quantity?: number | null
          series_id?: string | null
          note?: string | null
          active?: boolean
          created_by?: string | null
        }
        Update: {
          mode?: 'absolute' | 'over_breakeven'
          value?: number
          quantity?: number | null
          note?: string | null
          active?: boolean
          hit_at?: string | null
          hit_value?: number | null
        }
        Relationships: []
      }
      /** Conferences and trade shows, tracked the way grants are. */
      events: {
        Row: {
          id: string
          name: string
          organiser: string | null
          url: string | null
          starts_on: string | null
          ends_on: string | null
          registration_deadline: string | null
          early_bird_deadline: string | null
          venue: string | null
          city: string | null
          region: string | null
          country: string
          lat: number | null
          lon: number | null
          cost: number | null
          early_bird_cost: number | null
          currency: string
          cost_notes: string | null
          categories: string[]
          why_go: string | null
          relevance: number | null
          status: 'watching' | 'interested' | 'registered' | 'attending' | 'attended' | 'skipped'
          assigned_to: string | null
          travel_notes: string | null
          notes_md: string | null
          source: string
          external_key: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          organiser?: string | null
          url?: string | null
          starts_on?: string | null
          ends_on?: string | null
          registration_deadline?: string | null
          early_bird_deadline?: string | null
          venue?: string | null
          city?: string | null
          region?: string | null
          country?: string
          lat?: number | null
          lon?: number | null
          cost?: number | null
          early_bird_cost?: number | null
          currency?: string
          cost_notes?: string | null
          categories?: string[]
          why_go?: string | null
          relevance?: number | null
          status?: 'watching' | 'interested' | 'registered' | 'attending' | 'attended' | 'skipped'
          assigned_to?: string | null
          travel_notes?: string | null
          notes_md?: string | null
          source?: string
          external_key?: string | null
        }
        Update: {
          [key: string]: unknown
        }
        Relationships: []
      }
      /** One line off a supplier invoice — the paper every price traces back to. */
      product_purchases: {
        Row: {
          id: string
          product_id: string | null
          supplier: string
          invoice_no: string | null
          invoice_date: string
          description: string
          ref_no: string | null
          quantity: number | null
          pack_unit: string | null
          unit_price: number | null
          amount: number | null
          pack_size: number | null
          canonical_unit: string | null
          price_per_canonical: number | null
          is_product: boolean
          source_file: string | null
          storage_path: string | null
          created_at: string
        }
        Insert: {
          id?: string
          product_id?: string | null
          supplier?: string
          invoice_no?: string | null
          invoice_date: string
          description: string
          ref_no?: string | null
          quantity?: number | null
          pack_unit?: string | null
          unit_price?: number | null
          amount?: number | null
          pack_size?: number | null
          canonical_unit?: string | null
          price_per_canonical?: number | null
          is_product?: boolean
          source_file?: string | null
          storage_path?: string | null
          created_at?: string
        }
        Update: {
          product_id?: string | null
          storage_path?: string | null
          [key: string]: unknown
        }
        Relationships: []
      }
      pastures: {
        Row: {
          id: string
          name: string
          legal_description: string | null
          area_acres: number | string | null
          pasture_type: string | null
          satellite_enabled: boolean
          water_source_geom: string | null
          river_access: 'none' | 'all' | 'north_of'
          river_access_ref: string | null
          grazing_system: string
          harvest_efficiency: number | string
          min_rest_days: number
          residual_floor_kg_dm_ha: number | string | null
        }
        Insert: never
        Update: {
          water_source_geom?: string | null
          river_access?: 'none' | 'all' | 'north_of'
          river_access_ref?: string | null
          grazing_system?: string
          harvest_efficiency?: number
          min_rest_days?: number
          residual_floor_kg_dm_ha?: number | null
        }
        Relationships: []
      }
      sat_observations: {
        Row: {
          id: string
          scene_id: string
          subject_type: string
          subject_id: string
          zone_id: string | null
          sensed_on: string
          valid_fraction: number | string | null
          quality: 'full' | 'partial' | 'rejected'
          harmonized: boolean
          ndvi_mean: number | string | null
          ndvi_harmonized: number | string | null
          evi2_mean: number | string | null
          ndre_mean: number | string | null
          ndmi_mean: number | string | null
          s1_vv_mean: number | string | null
          s1_vh_mean: number | string | null
        }
        Insert: never
        Update: never
        Relationships: []
      }
      pasture_biomass_calibration: {
        Row: {
          id: string
          pasture_id: string | null
          sampled_on: string
          method: 'clip_and_weigh' | 'plate_meter' | 'visual_estimate'
          measured_kg_dm_ha: number
          ndvi_at_sample: number | null
          evi2_at_sample: number | null
          ndre_at_sample: number | null
          observation_gap_days: number | null
          sample_point: string | null
          photo_path: string | null
          notes: string | null
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          pasture_id?: string | null
          sampled_on: string
          method: 'clip_and_weigh' | 'plate_meter' | 'visual_estimate'
          measured_kg_dm_ha: number
          ndvi_at_sample?: number | null
          evi2_at_sample?: number | null
          ndre_at_sample?: number | null
          observation_gap_days?: number | null
          sample_point?: string | null
          photo_path?: string | null
          notes?: string | null
          created_by?: string | null
          created_at?: string
        }
        Update: {
          measured_kg_dm_ha?: number
          notes?: string | null
        }
        Relationships: []
      }
      grazing_events: {
        Row: {
          id: string
          pasture_id: string
          herd_id: string | null
          head_count: number | null
          avg_animal_weight_lb: number | null
          turned_in_on: string
          moved_out_on: string | null
          notes: string | null
          created_at: string
          /** The eShepherd activation this event was made from, if any. */
          eshepherd_activation_id: string | null
        }
        Insert: {
          id?: string
          pasture_id: string
          herd_id?: string | null
          head_count?: number | null
          avg_animal_weight_lb?: number | null
          turned_in_on: string
          moved_out_on?: string | null
          notes?: string | null
          created_at?: string
          eshepherd_activation_id?: string | null
        }
        Update: {
          head_count?: number | null
          moved_out_on?: string | null
          notes?: string | null
        }
        Relationships: []
      }
      users: {
        Row: {
          id: string
          email: string
          full_name: string
          role: UserRole
          phone: string | null
          active: boolean
          created_at: string
          calendar_feed_token: string
          nav_prefs: Json | null
          tile_prefs: Json | null
          denied_views: string[]
          /** An owner of the farm: sees the fixed-expense breakdown. Only an owner can change it. */
          is_owner: boolean
          /** Sees the owners-only financials without being an owner (the accountant). Only an owner can set it. */
          finance_access: boolean
        }
        Insert: {
          id: string
          email: string
          full_name: string
          role?: UserRole
          phone?: string | null
          active?: boolean
          created_at?: string
          calendar_feed_token?: string
          nav_prefs?: Json | null
          tile_prefs?: Json | null
        }
        Update: {
          id?: string
          email?: string
          full_name?: string
          role?: UserRole
          phone?: string | null
          active?: boolean
          created_at?: string
          calendar_feed_token?: string
          nav_prefs?: Json | null
          tile_prefs?: Json | null
          denied_views?: string[]
          is_owner?: boolean
          finance_access?: boolean
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          id: number
          table_name: string
          record_id: string
          action: string
          actor_id: string | null
          actor_role: string | null
          changed_at: string
          old_values: Json | null
          new_values: Json | null
          crop_year: number | null
        }
        Insert: never
        Update: never
        Relationships: []
      }
      /** Farm setup: one row of who the farm is, where, and which features it uses. Admins write it. */
      farm_setup: {
        Row: {
          id: string
          singleton: boolean
          farm_name: string | null
          app_name: string | null
          short_name: string | null
          logo_url: string | null
          map_center_lng: number | null
          map_center_lat: number | null
          time_zone: string
          province: string
          units: 'imperial' | 'metric'
          farm_description: string | null
          /** { featureKey: false } turns a feature off; a missing key is on. */
          features: Json
          /** [{ name, lat, lng, note? }]; null = the built-in list. */
          forecast_sites: Json | null
          retailer_name: string | null
          support_email: string | null
          irrigation_district_name: string | null
          combine_model: string | null
          main_ranch_id: string | null
          calf_sale_month: number | null
          calf_sale_weight_lb: number | null
          cattle_breed: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: Partial<Database['public']['Tables']['farm_setup']['Row']>
        Update: Partial<Database['public']['Tables']['farm_setup']['Row']>
        Relationships: []
      }
      farms: {        Row: {
          power_cost_kwh: number
          power_buy_kwh: number | null
          power_sell_kwh: number | null
          water_value_af: number | null
          power_value_basis: 'sell' | 'buy'
          id: string
          name: string
          fieldnet_url: string | null
          kc_mode: string
          weather_source: string
          river_station_number: string | null
          river_station_name: string | null
          river_alert_cms: number | null
          mymaps_url: string | null
          jd_work_url: string | null
        }
        Insert: {
          power_cost_kwh?: number
          power_buy_kwh?: number | null
          power_sell_kwh?: number | null
          water_value_af?: number | null
          power_value_basis?: 'sell' | 'buy'
          id?: string
          name: string
          fieldnet_url?: string | null
          kc_mode?: string
          weather_source?: string
        }
        Update: {
          power_cost_kwh?: number
          power_buy_kwh?: number | null
          power_sell_kwh?: number | null
          water_value_af?: number | null
          power_value_basis?: 'sell' | 'buy'
          id?: string
          name?: string
          fieldnet_url?: string | null
          kc_mode?: string
          weather_source?: string
          river_station_number?: string | null
          river_station_name?: string | null
          river_alert_cms?: number | null
          mymaps_url?: string | null
          jd_work_url?: string | null
        }
        Relationships: []
      }
      grazing_pastures: {
        Row: {
          id: string
          name: string
          sort_order: number
          km2: number
          non_grazeable_ac: number
          irrigated_ac: number
          grazeable_irrigated_ac: number
          grass_quality: string
          active: boolean
          ranch_id: string | null
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          sort_order?: number
          km2?: number
          non_grazeable_ac?: number
          irrigated_ac?: number
          grazeable_irrigated_ac?: number
          grass_quality?: string
          active?: boolean
          ranch_id?: string | null
        }
        Update: {
          name?: string
          sort_order?: number
          km2?: number
          non_grazeable_ac?: number
          irrigated_ac?: number
          grazeable_irrigated_ac?: number
          grass_quality?: string
          active?: boolean
        }
        Relationships: []
      }
      integration_health: {
        Row: {
          id: string
          source_key: string
          label: string
          category: string
          check_kind: string
          stale_after_min: number
          status: string
          detail: string | null
          last_success_at: string | null
          last_checked_at: string | null
          data_at: string | null
          consecutive_fail: number
          alerted: boolean
          enabled: boolean
          updated_at: string
        }
        Insert: {
          id?: string
          source_key: string
          label: string
          category?: string
          check_kind?: string
          stale_after_min?: number
        }
        Update: {
          label?: string
          stale_after_min?: number
          status?: string
          detail?: string | null
          enabled?: boolean
        }
        Relationships: []
      }
      /**
       * Feed put up, bought, sold or shrunk. One signed ledger.
       *
       * Feeding is NOT in here — it is already on the feed sheets, and a second
       * record of the same event drifts from the first the moment somebody
       * corrects a sheet. feed_on_hand subtracts the sheets instead.
       */
      /**
       * Farm news, already scored for how much it matters here.
       *
       * The URL is the identity: feeds republish and reword headlines, so it is
       * the only field that reliably says "we have this one already".
       */
      /**
       * Which Monday-meeting facts have been read out, ever.
       *
       * fact_id as the primary key is what makes a repeat impossible; one row
       * per week is what makes the choice stable for everybody at the meeting.
       * Written only through assign_meeting_fact.
       */
      /** One delivered load, read off the buyer's ticket and summed into its contract by trigger. */
      scale_tickets: {
        Row: {
          id: string
          /** Grain protein off the elevator ticket, %. */
          protein_pct: number | null
          crop_year: number
          crop_id: string | null
          contract_id: string | null
          bin_id: string | null
          buyer: string | null
          ticket_no: string | null
          delivered_on: string
          gross_lb: number | null
          tare_lb: number | null
          net_lb: number | null
          moisture_pct: number | null
          dockage_pct: number | null
          net_units: number | null
          unit: string | null
          notes: string | null
          extracted: Json | null
          bin_load_id: string | null
          receipt_no: string | null
          grade: string | null
          driver: string | null
          truck: string | null
          /** Generated: net less the dockage (clean-out). */
          clean_net_lb: number | null
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          /** Grain protein off the elevator ticket, %. */
          protein_pct?: number | null
          crop_year: number
          crop_id?: string | null
          contract_id?: string | null
          bin_id?: string | null
          buyer?: string | null
          ticket_no?: string | null
          delivered_on: string
          gross_lb?: number | null
          tare_lb?: number | null
          net_lb?: number | null
          moisture_pct?: number | null
          dockage_pct?: number | null
          net_units?: number | null
          unit?: string | null
          notes?: string | null
          extracted?: Json | null
          bin_load_id?: string | null
          receipt_no?: string | null
          grade?: string | null
          driver?: string | null
          truck?: string | null
          created_by?: string | null
          created_at?: string
        }
        Update: {
          /** Grain protein off the elevator ticket, %. */
          protein_pct?: number | null
          contract_id?: string | null
          bin_id?: string | null
          net_units?: number | null
          notes?: string | null
          receipt_no?: string | null
          grade?: string | null
          driver?: string | null
          truck?: string | null
        }
        Relationships: []
      }
      scale_ticket_photos: {
        Row: {
          id: string
          scale_ticket_id: string | null
          filename: string | null
          mime: string
          image_b64: string
          width: number | null
          height: number | null
          bytes: number | null
          source: string
          source_ref: string | null
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          scale_ticket_id?: string | null
          filename?: string | null
          mime?: string
          image_b64: string
          width?: number | null
          height?: number | null
          bytes?: number | null
          source?: string
          source_ref?: string | null
          created_by?: string | null
          created_at?: string
        }
        Update: {
          scale_ticket_id?: string | null
          filename?: string | null
          mime?: string
          image_b64?: string
          width?: number | null
          height?: number | null
          bytes?: number | null
          source?: string
          source_ref?: string | null
        }
        Relationships: []
      }
      /** Deere fields deleted here, so the sync cannot make them again. */
      jd_dismissed_fields: {
        Row: {
          jd_field_id: string
          name: string | null
          dismissed_at: string
          dismissed_by: string | null
        }
        /** Written by the trigger on fields, never by hand. */
        Insert: never
        Update: never
        Relationships: []
      }
      /** Virtual-paddock activation history from the eShepherd Status CSV. */
      /** Where the cattle drink: pins a person owns, dragged and renamed on the map. */
      cattle_water: {
        Row: {
          id: string
          name: string | null
          kind: 'dugout' | 'pond' | 'trough' | 'spring' | 'well' | 'other'
          drinkable: boolean
          /** PostGIS point; written as EWKT, read through cattle_water_points. */
          geom: string
          source: 'mymap' | 'manual'
          notes: string | null
          serves: string[]
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name?: string | null
          kind?: 'dugout' | 'pond' | 'trough' | 'spring' | 'well' | 'other'
          drinkable?: boolean
          geom: string
          source?: 'mymap' | 'manual'
          notes?: string | null
          serves?: string[]
          created_by?: string | null
        }
        Update: {
          name?: string | null
          kind?: 'dugout' | 'pond' | 'trough' | 'spring' | 'well' | 'other'
          drinkable?: boolean
          geom?: string
          notes?: string | null
          serves?: string[]
          updated_at?: string
        }
        Relationships: []
      }
      eshepherd_activations: {
        Row: {
          id: string
          mob: string
          paddock_name: string
          pasture_id: string | null
          status: string | null
          started_at: string
          ended_at: string | null
          head_count: number | null
          raw: Json | null
          imported_at: string
          imported_by: string | null
        }
        Insert: {
          id?: string
          mob: string
          paddock_name: string
          pasture_id?: string | null
          status?: string | null
          started_at: string
          ended_at?: string | null
          head_count?: number | null
          raw?: Json | null
          imported_at?: string
          imported_by?: string | null
        }
        Update: {
          pasture_id?: string | null
          ended_at?: string | null
          head_count?: number | null
        }
        Relationships: []
      }
      meeting_fact_log: {
        Row: { fact_id: string; week: string; shown_at: string }
        Insert: never
        Update: never
        Relationships: []
      }
      /** Facts written after the app shipped, so the library refills itself. */
      meeting_facts: {
        Row: {
          id: string
          topic: string
          title: string
          body: string
          so_what: string
          months: number[]
          /** Where it was checked, shown on the card as a link. */
          source_url: string | null
          source: string
          created_at: string
          retired_at: string | null
          retired_by: string | null
        }
        /** Written by the top-up job with the service key; retired through the
         *  retire_meeting_fact function. */
        Insert: never
        Update: never
        Relationships: []
      }
      ag_news: {
        Row: {
          id: string
          source: string
          title: string
          url: string
          summary: string | null
          published_at: string | null
          categories: string[]
          score: number
          /** The terms that earned the score, so a bad pick can be explained. */
          matched: string[]
          fetched_at: string
        }
        /** Written by the feed puller with the service key, never the client. */
        Insert: never
        Update: never
        Relationships: []
      }
      feed_inventory: {
        Row: {
          id: string
          ranch_id: string
          feed_type_id: string
          moved_on: string
          kind: 'opening' | 'harvested' | 'purchased' | 'sold' | 'shrink' | 'adjustment'
          /** Positive adds to the pile, negative takes away. */
          quantity: number
          unit: 'lb' | 'big_square' | 'round'
          lb_per_bale: number | null
          note: string | null
          created_at: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          id?: string
          ranch_id: string
          feed_type_id: string
          moved_on?: string
          kind?: 'opening' | 'harvested' | 'purchased' | 'sold' | 'shrink' | 'adjustment'
          quantity: number
          unit?: 'lb' | 'big_square' | 'round'
          lb_per_bale?: number | null
          note?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: Partial<Database['public']['Tables']['feed_inventory']['Insert']>
        Relationships: []
      }
      feed_types: {
        Row: {
          id: string
          name: string
          default_unit: 'lb' | 'big_square' | 'round'
          default_lb_per_bale: number | null
          is_bedding: boolean
          sort_order: number
          archived: boolean
          created_at: string
          category: 'hay' | 'greenfeed' | 'straw' | 'silage' | 'grain' | 'supplement' | 'other'
          legume: boolean
          /** Book values until a feed_tests row replaces them; TDN/CP dry-matter basis. */
          dm_pct: number | null
          tdn_pct: number | null
          cp_pct: number | null
          storage_loss_pct: number
          book_note: string | null
          /** As fed, $/t; null until known. */
          price_source: 'afsc' | 'manual' | 'estimate' | 'quickbooks' | null
          price_as_of: string | null
          price_note: string | null
          afsc_item: string | null
          price_per_tonne: number | null
        }
        Insert: {
          name: string
          default_unit?: 'lb' | 'big_square' | 'round'
          default_lb_per_bale?: number | null
          is_bedding?: boolean
          sort_order?: number
          archived?: boolean
          category?: 'hay' | 'greenfeed' | 'straw' | 'silage' | 'grain' | 'supplement' | 'other'
          legume?: boolean
          dm_pct?: number | null
          tdn_pct?: number | null
          cp_pct?: number | null
          storage_loss_pct?: number
          book_note?: string | null
          price_source?: 'afsc' | 'manual' | 'estimate' | 'quickbooks' | null
          price_as_of?: string | null
          price_note?: string | null
          afsc_item?: string | null
          price_per_tonne?: number | null
        }
        Update: Partial<Database['public']['Tables']['feed_types']['Insert']>
        Relationships: []
      }
      feed_records: {
        Row: {
          id: string
          ranch_id: string
          /** 'Cows', 'Calves' — free text, because the next sheet may say something else. */
          herd_group: string
          period_start: string
          period_end: string
          /** Head fed over this period; the divisor for lb/head/day. */
          head_count: number | null
          notes: string | null
          created_at: string
          updated_at: string
          updated_by: string | null
          herd_count_id: string | null
        }
        Insert: {
          ranch_id: string
          herd_group: string
          herd_count_id?: string | null
          period_start: string
          period_end: string
          head_count?: number | null
          notes?: string | null
          updated_by?: string | null
        }
        Update: Partial<Database['public']['Tables']['feed_records']['Insert']>
        Relationships: []
      }
      feed_record_lines: {
        Row: {
          id: string
          record_id: string
          feed_type_id: string | null
          feed_type_name: string
          quantity: number
          unit: 'lb' | 'big_square' | 'round'
          /** Only meaningful for a bale unit; null means the line cannot be weighed. */
          lb_per_bale: number | null
          purpose: 'feed' | 'bedding' | 'self_feeder'
          notes: string | null
          sort_order: number
          created_at: string
        }
        Insert: {
          record_id: string
          feed_type_name: string
          quantity: number
          feed_type_id?: string | null
          unit?: 'lb' | 'big_square' | 'round'
          lb_per_bale?: number | null
          purpose?: 'feed' | 'bedding' | 'self_feeder'
          notes?: string | null
          sort_order?: number
        }
        Update: Partial<Database['public']['Tables']['feed_record_lines']['Insert']>
        Relationships: []
      }
      herd_counts: {
        Row: {
          id: string
          ranch_id: string | null
          class_name: string
          head_count: number
          avg_weight_lb: number
          au_equivalent: number
          graze_start: string | null
          graze_end: string | null
          notes: string | null
          sort_order: number
          updated_at: string
          feed_class: 'cow' | 'bred_heifer' | 'heifer_calf' | 'backgrounder' | 'bull'
          /** Canadian 1–5. */
          bcs: number
          target_bcs: number
          target_gain_lb: number | null
          ration_note: string | null
          /** Calves only: how many are kept after weaning to background. */
          background_head: number | null
        }
        Insert: {
          id?: string
          ranch_id?: string | null
          class_name: string
          head_count?: number
          avg_weight_lb?: number
          au_equivalent?: number
          notes?: string | null
          sort_order?: number
          updated_at?: string
        }
        Update: {
          id?: string
          ranch_id?: string | null
          class_name?: string
          head_count?: number
          avg_weight_lb?: number
          au_equivalent?: number
          graze_start?: string | null
          graze_end?: string | null
          notes?: string | null
          sort_order?: number
          updated_at?: string
          feed_class?: 'cow' | 'bred_heifer' | 'heifer_calf' | 'backgrounder' | 'bull'
          bcs?: number
          target_bcs?: number
          target_gain_lb?: number | null
          ration_note?: string | null
          background_head?: number | null
        }
        Relationships: []
      }
      ici_field_lines: {
        Row: {
          id: string
          crop_year: number
          invoice_no: string
          invoice_date: string
          ref_no: string
          kind: 'blend' | 'edge' | 'floating' | 'delivery' | 'fertilizer' | 'other'
          description: string
          quantity: number | null
          unit: string | null
          amount: number
          field_id: string | null
          field_text: string | null
          crop_text: string | null
          density: number | null
          rate_lb_ac: number | null
          ticket_acres: number | null
          cost_per_ac: number | null
          target: Record<string, number> | null
          note: string | null
          imported_at: string
        }
        Insert: Partial<Database['public']['Tables']['ici_field_lines']['Row']> & { crop_year: number; invoice_no: string; invoice_date: string; ref_no: string; kind: string; description: string; amount: number }
        Update: Partial<Database['public']['Tables']['ici_field_lines']['Row']>
        Relationships: []
      }
      ici_fert_reviews: {
        Row: { id: string; crop_year: number; status: 'running' | 'done' | 'error'; request_hash: string | null; request: string | null; content: string | null; model: string | null; error: string | null; created_at: string; finished_at: string | null; created_by: string | null }
        Insert: { crop_year: number; status?: string; request?: string | null; content?: string | null; model?: string | null; error?: string | null; created_by?: string | null }
        Update: Partial<Database['public']['Tables']['ici_fert_reviews']['Insert']> & { finished_at?: string | null }
        Relationships: []
      }
      water_supply_daily: {
        Row: { station: string; day: string; value: number | null; median: number | null; unit: string | null }
        Insert: { station: string; day: string; value?: number | null; median?: number | null; unit?: string | null }
        Update: Partial<Database['public']['Tables']['water_supply_daily']['Insert']>
        Relationships: []
      }
      eshepherd_repro: {
        Row: {
          animal_id: string
          tag: string
          mob: string
          state: string
          prev_state: string | null
          state_start: string | null
          last_heat: string | null
          days_since_heat: number | null
          not_cycling_since: string | null
          nc_days: number | null
          observed_on: string
          synced_at: string
          heats: string[]
        }
        Insert: Omit<Database['public']['Tables']['eshepherd_repro']['Row'], 'synced_at' | 'heats'> & { synced_at?: string; heats?: string[] }
        Update: Partial<Database['public']['Tables']['eshepherd_repro']['Insert']>
        Relationships: []
      }
      eshepherd_repro_history: {
        Row: { animal_id: string; observed_on: string; state: string; mob: string | null }
        Insert: { animal_id: string; observed_on: string; state: string; mob?: string | null }
        Update: Partial<Database['public']['Tables']['eshepherd_repro_history']['Insert']>
        Relationships: []
      }
      solar_sites: {
        Row: {
          id: string
          solis_station_id: string | null
          name: string
          label: string | null
          address: string | null
          capacity_kwp: number | null
          field_id: string | null
          time_zone: number | null
          first_generation_on: string | null
          sort_order: number | null
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: Partial<Omit<Database['public']['Tables']['solar_sites']['Row'], 'name'>> & { name: string }
        Update: Partial<Database['public']['Tables']['solar_sites']['Row']>
        Relationships: []
      }
      solar_daily: {
        Row: {
          site_id: string
          day: string
          produced_kwh: number | null
          grid_export_kwh: number | null
          grid_import_kwh: number | null
          home_load_kwh: number | null
          source: 'month' | 'live'
          synced_at: string
        }
        Insert: Partial<Database['public']['Tables']['solar_daily']['Row']> & { site_id: string; day: string }
        Update: Partial<Database['public']['Tables']['solar_daily']['Row']>
        Relationships: []
      }
      solar_latest: {
        Row: {
          site_id: string
          power_kw: number | null
          today_kwh: number | null
          month_kwh: number | null
          year_kwh: number | null
          total_kwh: number | null
          state: number | null
          reading_at: string | null
          updated_at: string
        }
        Insert: Partial<Database['public']['Tables']['solar_latest']['Row']> & { site_id: string }
        Update: Partial<Database['public']['Tables']['solar_latest']['Row']>
        Relationships: []
      }
      feed_tests: {
        Row: {
          id: string
          feed_type_id: string
          sampled_on: string
          lab: string | null
          dm_pct: number | null
          cp_pct: number | null
          tdn_pct: number | null
          adf_pct: number | null
          ndf_pct: number | null
          /** % NO3 of dry matter. */
          nitrate_pct: number | null
          ca_pct: number | null
          p_pct: number | null
          notes: string | null
          created_at: string
          updated_by: string | null
        }
        Insert: {
          feed_type_id: string
          sampled_on?: string
          lab?: string | null
          dm_pct?: number | null
          cp_pct?: number | null
          tdn_pct?: number | null
          adf_pct?: number | null
          ndf_pct?: number | null
          nitrate_pct?: number | null
          ca_pct?: number | null
          p_pct?: number | null
          notes?: string | null
          updated_by?: string | null
        }
        Update: Partial<Database['public']['Tables']['feed_tests']['Insert']>
        Relationships: []
      }
      feed_group_ration: {
        Row: {
          id: string
          herd_count_id: string
          feed_type_id: string
          dm_share_pct: number
          waste_pct: number
          sort_order: number
          updated_at: string
        }
        Insert: { id?: string; herd_count_id: string; feed_type_id: string; dm_share_pct?: number; waste_pct?: number; sort_order?: number }
        Update: { dm_share_pct?: number; waste_pct?: number; sort_order?: number; updated_at?: string }
        Relationships: []
      }
      stubble_grazing: {
        Row: {
          id: string
          ranch_id: string
          field_id: string | null
          name: string
          acres: number
          yield_bu: number
          herd_count_id: string | null
          start_date: string | null
          weather_loss_pct: number
          ears_counted: number | null
          snow_state: 'open' | 'snow' | 'crust'
          notes: string | null
          created_at: string
        }
        Insert: {
          ranch_id: string
          name: string
          acres: number
          yield_bu: number
          field_id?: string | null
          herd_count_id?: string | null
          start_date?: string | null
          weather_loss_pct?: number
          ears_counted?: number | null
          snow_state?: 'open' | 'snow' | 'crust'
          notes?: string | null
        }
        Update: Partial<Database['public']['Tables']['stubble_grazing']['Insert']>
        Relationships: []
      }
      grazing_herd: {
        Row: {
          id: string
          animal_type: string
          weight_lb: number | null
          au_equivalent: number
          head_count: number
          start_date: string | null
          end_date: string | null
          sort_order: number
          ranch_id: string | null
          created_at: string
        }
        Insert: {
          id?: string
          animal_type: string
          weight_lb?: number | null
          au_equivalent?: number
          head_count?: number
          start_date?: string | null
          end_date?: string | null
          sort_order?: number
          ranch_id?: string | null
        }
        Update: {
          animal_type?: string
          weight_lb?: number | null
          au_equivalent?: number
          head_count?: number
          start_date?: string | null
          end_date?: string | null
          sort_order?: number
        }
        Relationships: []
      }
      field_hail_events: {
        Row: {
          id: string
          field_id: string
          crop_year: number
          event_date: string
          notes: string | null
          loss_pct: number | null
          acres: number | null
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          field_id: string
          crop_year: number
          event_date?: string
          notes?: string | null
          loss_pct?: number | null
          acres?: number | null
        }
        Update: { id?: string; event_date?: string; notes?: string | null; loss_pct?: number | null; acres?: number | null }
        Relationships: []
      }
      aimm_watch: {
        Row: {
          id: string
          label: string
          url: string
          last_hash: string | null
          last_checked: string | null
          changed_at: string | null
          status: string
          last_error: string | null
        }
        Insert: never
        Update: never
        Relationships: []
      }
      fertility_rx: {
        Row: {
          id: string
          crop_year: number
          /** Null while the legal description has not resolved to one of ours. */
          field_id: string | null
          field_label: string
          legal: string | null
          crop_type: string | null
          variety: string | null
          acres: number | string | null
          yield_goal: number | string | null
          yield_unit: string | null
          /** "Spring", "NO RX", "V2 Corn half of pivot". */
          description: string | null
          rec_crop_type: string | null
          rec_yield_goal: number | string | null
          total_acres: number | string | null
          /** [{label, analysis, avgRate, totalLbs}] */
          products: Json
          source_file: string | null
          source_page: number | null
          imported_at: string
          created_at: string
        }
        Insert: { crop_year: number; field_label: string }
        Update: Partial<Database['public']['Tables']['fertility_rx']['Insert']>
        Relationships: []
      }
      fertility_rx_zones: {
        Row: {
          id: string
          rx_id: string
          zone: number
          fertility_index: string | null
          acres: number | string | null
          yield_goal: number | string | null
          n: number | string | null
          p2o5: number | string | null
          k2o: number | string | null
          s: number | string | null
          /** Micronutrients the report printed, e.g. {"Micro Zn": 1.7}. */
          extra: Json
          /** {analysis: lbs per acre} on this zone. */
          products: Json
        }
        Insert: { rx_id: string; zone: number }
        Update: Partial<Database['public']['Tables']['fertility_rx_zones']['Insert']>
        Relationships: []
      }
      manure_applications: {
        Row: {
          id: string
          /** Sets the ammonium share and how fast the organic N comes back. */
          manure_type: 'fresh_pen' | 'stockpiled' | 'straw_bedded' | 'composted' | null
          /** Days from spreading to working it in. */
          incorporated_days: number | null
          /** Null where the spread straddles a boundary or is on rented ground. */
          field_id: string | null
          crop_year: number
          applied_on: string | null
          /** 'solid_beef' | 'solid_dairy' | 'compost' | 'liquid_hog'. */
          source: string
          rate_tons_per_acre: number | string | null
          /** A manure test, where one was done. Null means the typical analysis. */
          n_lb_ton: number | string | null
          p2o5_lb_ton: number | string | null
          k2o_lb_ton: number | string | null
          incorporated: boolean | null
          /** MultiPolygon, drawn in the browser. */
          geojson: Json
          acres: number | string | null
          notes: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          /** Sets the ammonium share and how fast the organic N comes back. */
          manure_type?: 'fresh_pen' | 'stockpiled' | 'straw_bedded' | 'composted' | null
          /** Days from spreading to working it in. */
          incorporated_days?: number | null
          field_id?: string | null
          crop_year: number
          applied_on?: string | null
          source?: string
          rate_tons_per_acre?: number | null
          n_lb_ton?: number | null
          p2o5_lb_ton?: number | null
          k2o_lb_ton?: number | null
          incorporated?: boolean | null
          geojson: Json
          acres?: number | null
          notes?: string | null
          created_by?: string | null
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['manure_applications']['Insert']>
        Relationships: []
      }
      fields: {
        Row: {
          grazed_after_harvest: boolean
          open_to_pasture: boolean
          grazing_note: string | null
          rain_gauge_id: string | null
          id: string
          farm_id: string
          name: string
          legal_land_description: string | null
          route_via: 'auto' | 'trails'
          route_through: { lat: number; lng: number }[] | null
          fah_field_id: number | null
          active: boolean
          notes_md: string | null
          rented_out_acres: number | null
          rented_out_to: string | null
          /** The renter's crop on a part-rented field ('potato'); passes Deere tags with it are theirs. */
          rented_out_crop: string | null
          tenure_notes: string | null
          pivot_start_instructions_md: string | null
          soil_notes_md: string | null
          created_at: string
          jd_field_id: string | null
          assigned_station_id: string | null
          assignment_mode: string
          soil_texture: string | null
          soil_fc: number | null
          soil_wp: number | null
          /** 'survey' from AGRASID, 'manual' when a person set them. */
          soil_source: 'survey' | 'manual' | null
        }
        Insert: {
          rain_gauge_id?: string | null
          id?: string
          farm_id: string
          name: string
          legal_land_description?: string | null
          route_via?: 'auto' | 'trails'
          route_through?: { lat: number; lng: number }[] | null
          fah_field_id?: number | null
          active?: boolean
          notes_md?: string | null
          rented_out_acres?: number | null
          rented_out_to?: string | null
          rented_out_crop?: string | null
          tenure_notes?: string | null
          pivot_start_instructions_md?: string | null
          soil_notes_md?: string | null
          created_at?: string
          jd_field_id?: string | null
        }
        Update: {
          grazed_after_harvest?: boolean
          open_to_pasture?: boolean
          grazing_note?: string | null
          rain_gauge_id?: string | null
          id?: string
          farm_id?: string
          name?: string
          legal_land_description?: string | null
          route_via?: 'auto' | 'trails'
          route_through?: { lat: number; lng: number }[] | null
          fah_field_id?: number | null
          active?: boolean
          notes_md?: string | null
          rented_out_acres?: number | null
          rented_out_to?: string | null
          rented_out_crop?: string | null
          tenure_notes?: string | null
          pivot_start_instructions_md?: string | null
          soil_notes_md?: string | null
          created_at?: string
          jd_field_id?: string | null
          assigned_station_id?: string | null
          assignment_mode?: string
          soil_texture?: string | null
          soil_fc?: number | null
          soil_wp?: number | null
          soil_source?: 'survey' | 'manual' | null
        }
        Relationships: []
      }
      bin_readings: {
        Row: {
          id: string
          bin_id: string
          reading_at: string
          moisture_pct: number | null
          temp_c: number | null
          source: string
          created_by: string | null
        }
        Insert: {
          id?: string
          bin_id: string
          reading_at?: string
          moisture_pct?: number | null
          temp_c?: number | null
          source?: string
          created_by?: string | null
        }
        Update: {
          id?: string
          bin_id?: string
          reading_at?: string
          moisture_pct?: number | null
          temp_c?: number | null
          source?: string
          created_by?: string | null
        }
        Relationships: []
      }
      field_boundaries: {
        Row: {
          id: string
          field_id: string
          geom: unknown
          valid_from: string
          valid_to: string | null
          source: BoundarySource
          acres: number
          created_at: string
        }
        Insert: {
          id?: string
          field_id: string
          geom: unknown
          valid_from?: string
          valid_to?: string | null
          source: BoundarySource
          billable_acres?: number | null
          created_at?: string
        }
        Update: {
          id?: string
          field_id?: string
          geom?: unknown
          valid_from?: string
          valid_to?: string | null
          source?: BoundarySource
          billable_acres?: number | null
          created_at?: string
        }
        Relationships: []
      }
      map_layers: {
        Row: {
          id: string
          name: string
          layer_type: LayerType
          style: Json
          visible_default: boolean
          sort_order: number
        }
        Insert: {
          id?: string
          name: string
          layer_type: LayerType
          style?: Json
          visible_default?: boolean
          sort_order?: number
        }
        Update: {
          id?: string
          name?: string
          layer_type?: LayerType
          style?: Json
          visible_default?: boolean
          sort_order?: number
        }
        Relationships: []
      }
      map_features: {
        Row: {
          id: string
          layer_id: string
          field_id: string | null
          geom: unknown
          properties: Json
          label: string | null
        }
        Insert: {
          id?: string
          layer_id: string
          field_id?: string | null
          geom: unknown
          properties?: Json
          label?: string | null
        }
        Update: {
          id?: string
          layer_id?: string
          field_id?: string | null
          geom?: unknown
          properties?: Json
          label?: string | null
        }
        Relationships: []
      }
      field_files: {
        Row: {
          id: string
          field_id: string
          kind: FieldFileKind
          storage_path: string
          filename: string
          crop_year: number | null
          uploaded_by: string | null
          uploaded_at: string
          meta: Json
        }
        Insert: {
          id?: string
          field_id: string
          kind: FieldFileKind
          storage_path: string
          filename: string
          crop_year?: number | null
          uploaded_by?: string | null
          uploaded_at?: string
          meta?: Json
        }
        Update: {
          id?: string
          field_id?: string
          kind?: FieldFileKind
          storage_path?: string
          filename?: string
          crop_year?: number | null
          uploaded_by?: string | null
          uploaded_at?: string
          meta?: Json
        }
        Relationships: []
      }
      crop_bin_overrides: {
        Row: {
          id: string
          crop_year: number
          crop_id: string
          /** Null = use the crop's own needs_bins. */
          needs_bins: boolean | null
          /** Null = all of it; a number = bushels that actually need a bin. */
          stored_bu: number | string | null
          note: string | null
          updated_at: string
        }
        Insert: {
          crop_year: number
          crop_id: string
          needs_bins?: boolean | null
          stored_bu?: number | null
          note?: string | null
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['crop_bin_overrides']['Insert']>
        Relationships: []
      }
      crops: {
        Row: {
          id: string
          name: string
          category: CropCategory | null
          notes_planting: string | null
          notes_growing: string | null
          notes_harvest: string | null
          notes_storage: string | null
          default_yield_per_acre: number | null
          yield_unit: YieldUnit
          active: boolean
          color: string | null
          /** Is this OURS to seed? False for summer fallow, established
           *  perennials, and crop-shared ground a partner plants. Drives the
           *  seeding progress target. */
          counts_for_seeding: boolean
          /** Is this ours to harvest? Drives the harvest progress target. */
          counts_for_harvest: boolean
          /** Why a crop is exempt, so an exemption never looks like a bug. */
          progress_note: string | null
          /** False where the crop is baled or shipped direct and never binned. */
          needs_bins: boolean
          bin_policy: BinPolicy
          test_weight_lb_per_bu: number | null
          cheatsheet_md: string | null
          crop_coefficient_id: string | null
          min_return_years: number
          margin_per_acre: number | null
          renter_only: boolean
          irrigation_need_in: number | null
          irrigation_need_basis: 'alberta' | 'farm' | null
          max_in_a_row: number
          stand_min_years: number | null
          stand_max_years: number | null
          own_use: boolean
          feed_dm_pct: number | null
          afsc_insured: boolean
          fixed_costs_apply: boolean
          sister_value_per_acre: number | null
          sister_value_note: string | null
          /** We rent the land out for this crop: no yield or price is expected (carrot, spinach seed). */
          land_rent_only: boolean
          /** Canola only: the herbicide the crop is bred to survive (canola-trait.ts). Null = not set. */
          herbicide_trait: 'liberty' | 'roundup' | 'both' | null
          /** A planning stand-in (Unknown Canola): its price, budget, normal yield and sister value are kept as the average of these crops'. */
          average_of: string[] | null
          margin_source: string | null
          /** Which Model 919 chart this crop is read on. The tables ship in
           *  src/data/919-charts; there is no chart table in the database. */
          moisture_chart_key: string | null
          /** Upper edge of each moisture band. Null folds that band and
           *  everything above it into the next one — see lib/moisture.ts. */
          moisture_dry_max: number | null
          moisture_tough_max: number | null
          moisture_damp_max: number | null
          moisture_moist_max: number | null
          moisture_note: string | null
          moisture_dry_min: number | null
          moisture_tough_advice: string | null
        }
        Insert: {
          counts_for_seeding?: boolean
          counts_for_harvest?: boolean
          progress_note?: string | null
          id?: string
          name: string
          category?: string | null
          default_yield_per_acre?: number | null
          yield_unit?: YieldUnit
          active?: boolean
          color?: string | null
          needs_bins?: boolean
          bin_policy?: BinPolicy
          test_weight_lb_per_bu?: number | null
          cheatsheet_md?: string | null
          crop_coefficient_id?: string | null
          min_return_years?: number
          margin_per_acre?: number | null
          renter_only?: boolean
          irrigation_need_in?: number | null
          irrigation_need_basis?: 'alberta' | 'farm' | null
          max_in_a_row?: number
          stand_min_years?: number | null
          stand_max_years?: number | null
          own_use?: boolean
          feed_dm_pct?: number | null
          afsc_insured?: boolean
          fixed_costs_apply?: boolean
          sister_value_per_acre?: number | null
          sister_value_note?: string | null
          land_rent_only?: boolean
          herbicide_trait?: 'liberty' | 'roundup' | 'both' | null
          average_of?: string[] | null
          margin_source?: string | null
          moisture_chart_key?: string | null
          moisture_dry_max?: number | null
          moisture_tough_max?: number | null
          moisture_damp_max?: number | null
          moisture_moist_max?: number | null
          moisture_note?: string | null
          moisture_dry_min?: number | null
          moisture_tough_advice?: string | null
        }
        Update: {
          counts_for_seeding?: boolean
          counts_for_harvest?: boolean
          progress_note?: string | null
          id?: string
          name?: string
          category?: string | null
          default_yield_per_acre?: number | null
          yield_unit?: YieldUnit
          active?: boolean
          color?: string | null
          needs_bins?: boolean
          bin_policy?: BinPolicy
          test_weight_lb_per_bu?: number | null
          cheatsheet_md?: string | null
          crop_coefficient_id?: string | null
          min_return_years?: number
          margin_per_acre?: number | null
          renter_only?: boolean
          irrigation_need_in?: number | null
          irrigation_need_basis?: 'alberta' | 'farm' | null
          max_in_a_row?: number
          stand_min_years?: number | null
          stand_max_years?: number | null
          own_use?: boolean
          feed_dm_pct?: number | null
          afsc_insured?: boolean
          fixed_costs_apply?: boolean
          sister_value_per_acre?: number | null
          sister_value_note?: string | null
          land_rent_only?: boolean
          herbicide_trait?: 'liberty' | 'roundup' | 'both' | null
          average_of?: string[] | null
          margin_source?: string | null
          moisture_chart_key?: string | null
          moisture_dry_max?: number | null
          moisture_tough_max?: number | null
          moisture_damp_max?: number | null
          moisture_moist_max?: number | null
          moisture_note?: string | null
          moisture_dry_min?: number | null
          moisture_tough_advice?: string | null
        }
        Relationships: []
      }
      crop_succession_rules: {
        Row: {
          id: string
          prev_crop_id: string
          next_crop_id: string
          /** Null on rules created before the farm's three-tier rotation sheet. */
          preference: 'recommended' | 'possible' | 'caution' | 'no_go' | null
          notes: string | null
          /** 'farm' = the farm's rotation sheet; 'research' = reports/Southern Alberta crop rotation.md. */
          source: string
          created_at: string
        }
        Insert: {
          id?: string
          prev_crop_id: string
          next_crop_id: string
          preference?: 'recommended' | 'possible' | 'caution' | 'no_go' | null
          notes?: string | null
          source?: string
        }
        Update: Partial<Database['public']['Tables']['crop_succession_rules']['Insert']>
        Relationships: []
      }
      hail_inspections: {
        Row: {
          id: string
          inspection_number: string
          field_id: string | null
          match_confidence: string | null
          land_location: string
          crop_label: string | null
          damage_date: string | null
          report_date: string | null
          loss_notice_date: string | null
          adjuster: string | null
          acres: number | null
          loss_pct: number | null
          bands: Json | null
          storage_path: string | null
          source: string | null
          status: string
          applied_at: string | null
          applied_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          inspection_number: string
          field_id?: string | null
          match_confidence?: string | null
          land_location: string
          crop_label?: string | null
          damage_date?: string | null
          report_date?: string | null
          loss_notice_date?: string | null
          adjuster?: string | null
          acres?: number | null
          loss_pct?: number | null
          bands?: Json | null
          storage_path?: string | null
          source?: string | null
          status?: string
          applied_at?: string | null
          applied_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          inspection_number?: string
          field_id?: string | null
          match_confidence?: string | null
          land_location?: string
          crop_label?: string | null
          damage_date?: string | null
          report_date?: string | null
          loss_notice_date?: string | null
          adjuster?: string | null
          acres?: number | null
          loss_pct?: number | null
          bands?: Json | null
          storage_path?: string | null
          source?: string | null
          status?: string
          applied_at?: string | null
          applied_by?: string | null
          created_at?: string
        }
        Relationships: []
      }
      planter_plates: {
        Row: {
          id: string
          name: string
          holes: number
          notes: string | null
          active: boolean
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          holes: number
          notes?: string | null
          active?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          holes?: number
          notes?: string | null
          active?: boolean
          created_at?: string
        }
        Relationships: []
      }
      meeting_notes: {
        Row: {
          id: string
          week_start: string
          plan: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          id?: string
          week_start: string
          plan?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          id?: string
          week_start?: string
          plan?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      grants: {
        Row: {
          id: string
          title: string
          funder: string | null
          url: string | null
          status: GrantStatus
          amount_min: number | null
          amount_max: number | null
          eligibility_summary: string | null
          summary: string | null
          notes_md: string | null
          opens_on: string | null
          closes_on: string | null
          region: string | null
          categories: string[]
          assigned_to: string | null
          source: string
          external_key: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          title: string
          funder?: string | null
          url?: string | null
          status?: GrantStatus
          amount_min?: number | null
          amount_max?: number | null
          eligibility_summary?: string | null
          summary?: string | null
          notes_md?: string | null
          opens_on?: string | null
          closes_on?: string | null
          region?: string | null
          categories?: string[]
          assigned_to?: string | null
          source?: string
          external_key?: string | null
        }
        Update: {
          title?: string
          funder?: string | null
          url?: string | null
          status?: GrantStatus
          amount_min?: number | null
          amount_max?: number | null
          eligibility_summary?: string | null
          summary?: string | null
          notes_md?: string | null
          opens_on?: string | null
          closes_on?: string | null
          region?: string | null
          categories?: string[]
          assigned_to?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      fieldnet_systems: {
        Row: {
          depth_correction: number
          applied_behind_deg: number | null
          applied_geom: Json | null
          applied_mean_mm: number | null
          applied_min_mm: number | null
          applied_sectors: Json | null
          applied_windows: Json | null
          applied_watermark_at: string | null
          applied_watermark_mm: number | null
          /** The pivot's watered arc, clockwise from start (degrees from north). Null = read raw. */
          arc_start_deg: number | null
          arc_end_deg: number | null
          /** Wetted radius in metres. Null = read raw.system_length_wet. */
          radius_m: number | null
          panel_last_seen: string | null
          comms_status: string | null
          device_updated_at: string | null
          direction: string | null
          field_id: string | null
          fieldnet_id: string
          geometry: Json | null
          id: string
          irrigator_type: string | null
          is_water_on: boolean | null
          latitude: number | null
          longitude: number | null
          name: string | null
          operational_status: string | null
          raw: Json
          speed_pct: number | null
          subtype: string | null
          synced_at: string
        }
        Insert: {
          depth_correction?: number
          arc_start_deg?: number | null
          arc_end_deg?: number | null
          radius_m?: number | null
          panel_last_seen?: string | null
          comms_status?: string | null
          device_updated_at?: string | null
          direction?: string | null
          field_id?: string | null
          fieldnet_id: string
          geometry?: Json | null
          id?: string
          irrigator_type?: string | null
          is_water_on?: boolean | null
          latitude?: number | null
          longitude?: number | null
          name?: string | null
          operational_status?: string | null
          raw?: Json
          speed_pct?: number | null
          subtype?: string | null
          synced_at?: string
        }
        Update: {
          depth_correction?: number
          arc_start_deg?: number | null
          arc_end_deg?: number | null
          radius_m?: number | null
          panel_last_seen?: string | null
          comms_status?: string | null
          device_updated_at?: string | null
          direction?: string | null
          field_id?: string | null
          fieldnet_id?: string
          geometry?: Json | null
          id?: string
          irrigator_type?: string | null
          is_water_on?: boolean | null
          latitude?: number | null
          longitude?: number | null
          name?: string | null
          operational_status?: string | null
          raw?: Json
          speed_pct?: number | null
          subtype?: string | null
          synced_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'fieldnet_systems_field_id_fkey'
            columns: ['field_id']
            isOneToOne: false
            referencedRelation: 'fields'
            referencedColumns: ['id']
          },
        ]
      }
      field_inspections: {
        Row: {
          id: string
          field_id: string
          crop_year: number
          crop_id: string | null
          status: string
          rating: string | null
          notes: string | null
          inspected_on: string | null
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          field_id: string
          crop_year: number
          crop_id?: string | null
          status?: string
          rating?: string | null
          notes?: string | null
          inspected_on?: string | null
        }
        Update: {
          crop_id?: string | null
          status?: string
          rating?: string | null
          notes?: string | null
          inspected_on?: string | null
        }
        Relationships: []
      }
      field_crop_zones: {
        Row: {
          id: string
          field_id: string
          crop_year: number
          crop_id: string
          acres: number | null
          geojson: Json | null
          notes: string | null
          source: string
          created_at: string
        }
        Insert: {
          id?: string
          field_id: string
          crop_year: number
          crop_id: string
          acres?: number | null
          geojson?: Json | null
          notes?: string | null
          source?: string
        }
        Update: {
          crop_id?: string
          acres?: number | null
          geojson?: Json | null
          notes?: string | null
        }
        Relationships: []
      }
      crop_prices: {
        Row: {
          id: string
          crop_id: string
          crop_year: number
          price_per_unit: number
        }
        Insert: {
          id?: string
          crop_id: string
          crop_year: number
          price_per_unit: number
        }
        Update: {
          id?: string
          crop_id?: string
          crop_year?: number
          price_per_unit?: number
        }
        Relationships: []
      }
      crop_varieties: {
        /** `company` is the seed company or contract holder — BASF, Corteva.
         *  It reads ahead of the crop name, so "Canola" shows as "BASF Canola"
         *  wherever a plan records which variety went in. */
        Row: {
          id: string
          crop_id: string
          name: string
          company: string | null
          active: boolean
          created_at: string
        }
        Insert: { id?: string; crop_id: string; name: string; company?: string | null; active?: boolean }
        Update: { id?: string; crop_id?: string; name?: string; company?: string | null; active?: boolean }
        Relationships: []
      }
      crop_inputs: {
        Row: {
          id: string
          crop_id: string
          crop_year: number
          name: string
          category: InputCategory
          cost_per_acre: number
          /** The farm-wide fixed expense, written from farm_fixed_costs. A person's edit is refused. */
          farm_fixed: boolean
          /** The land share on land rented out: readable only by can_see_finances(), never audited. */
          fixed_land_share: boolean
        }
        Insert: {
          id?: string
          crop_id: string
          crop_year: number
          name: string
          category?: InputCategory
          cost_per_acre?: number
        }
        Update: {
          id?: string
          crop_id?: string
          crop_year?: number
          name?: string
          category?: InputCategory
          cost_per_acre?: number
        }
        Relationships: []
      }
      /** Farm-wide fixed expenses per crop year. Everyone reads per_acre; only owners write. */
      farm_fixed_costs: {
        Row: {
          id: string
          crop_year: number
          mode: 'lump' | 'breakdown'
          lump_per_acre: number | null
          spread_acres: number | null
          /** Worked out by the database from the lump or the breakdown. */
          per_acre: number
          note: string | null
          updated_by: string | null
          updated_at: string
        }
        Insert: {
          id?: string
          crop_year: number
          mode?: 'lump' | 'breakdown'
          lump_per_acre?: number | null
          spread_acres?: number | null
          note?: string | null
          updated_by?: string | null
          updated_at?: string
        }
        Update: {
          mode?: 'lump' | 'breakdown'
          lump_per_acre?: number | null
          spread_acres?: number | null
          note?: string | null
          updated_by?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      /** Owner-only: what the fixed expenses are made of. */
      farm_fixed_cost_lines: {
        Row: {
          id: string
          crop_year: number
          category: 'land' | 'labour' | 'machinery' | 'depreciation' | 'overhead'
          basis: 'per_acre' | 'farm_total'
          amount: number
          note: string | null
          updated_by: string | null
          updated_at: string
        }
        Insert: {
          id?: string
          crop_year: number
          category: 'land' | 'labour' | 'machinery' | 'depreciation' | 'overhead'
          basis?: 'per_acre' | 'farm_total'
          amount: number
          note?: string | null
          updated_by?: string | null
          updated_at?: string
        }
        Update: {
          basis?: 'per_acre' | 'farm_total'
          amount?: number
          note?: string | null
          updated_by?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      farm_fixed_cost_line_history: {
        Row: {
          id: string
          line_id: string
          crop_year: number
          action: string
          old_values: Json | null
          new_values: Json | null
          actor_id: string | null
          at: string
        }
        Insert: never
        Update: never
        Relationships: []
      }
      crop_plans: {
        Row: {
          id: string
          crop_year: number
          field_id: string
          crop_id: string
          variety: string | null
          planned_acres: number | null
          yield_per_acre_override: number | null
          /** Which yield the plan holds: 'clean', 'pre_clean' (field-run), or null for an estimate. */
          yield_basis: 'clean' | 'pre_clean' | null
          notes: string | null
          /** Swathed or straight-cut; starts the dry-down prediction's drying rate. */
          harvest_method: 'swathed' | 'straight' | null
        }
        Insert: {
          id?: string
          crop_year: number
          field_id: string
          crop_id: string
          variety?: string | null
          planned_acres?: number | null
          yield_per_acre_override?: number | null
          yield_basis?: 'clean' | 'pre_clean' | null
          notes?: string | null
          harvest_method?: 'swathed' | 'straight' | null
        }
        Update: {
          id?: string
          crop_year?: number
          field_id?: string
          crop_id?: string
          variety?: string | null
          planned_acres?: number | null
          yield_per_acre_override?: number | null
          yield_basis?: 'clean' | 'pre_clean' | null
          notes?: string | null
          harvest_method?: 'swathed' | 'straight' | null
        }
        Relationships: []
      }
      crop_history: {
        Row: {
          id: string
          /** Scale total as weighed, before shrinking wet loads. */
          scale_wet_total: number | null
          crop_year: number
          field_id: string
          crop_id: string
          variety: string | null
          acres: number | null
          yield_per_acre: number | null
          yield_unit: YieldUnit | null
          actual_yield_total: number | null
          source: HistorySource
          scale_total: number | null
          scale_acres: number | null
          scale_loads: number | null
          scale_at: string | null
          yield_override: boolean
          plan_yield_before: number | null
          plan_yield_saved: boolean
          clean_total: number | null
          clean_yield_per_acre: number | null
        }
        Insert: {
          id?: string
          /** Scale total as weighed, before shrinking wet loads. */
          scale_wet_total?: number | null
          crop_year: number
          field_id: string
          crop_id: string
          variety?: string | null
          acres?: number | null
          yield_per_acre?: number | null
          yield_unit?: YieldUnit | null
          actual_yield_total?: number | null
          source?: HistorySource
          scale_total?: number | null
          scale_acres?: number | null
          scale_loads?: number | null
          scale_at?: string | null
          yield_override?: boolean
          plan_yield_before?: number | null
          plan_yield_saved?: boolean
          clean_total?: number | null
          clean_yield_per_acre?: number | null
        }
        Update: {
          id?: string
          /** Scale total as weighed, before shrinking wet loads. */
          scale_wet_total?: number | null
          crop_year?: number
          field_id?: string
          crop_id?: string
          variety?: string | null
          acres?: number | null
          yield_per_acre?: number | null
          yield_unit?: YieldUnit | null
          actual_yield_total?: number | null
          source?: HistorySource
          scale_total?: number | null
          scale_acres?: number | null
          scale_loads?: number | null
          scale_at?: string | null
          yield_override?: boolean
          plan_yield_before?: number | null
          plan_yield_saved?: boolean
          clean_total?: number | null
          clean_yield_per_acre?: number | null
        }
        Relationships: []
      }
      tasks: {
        Row: {
          id: string
          title: string
          description_md: string | null
          field_id: string | null
          assigned_to: string | null
          created_by: string
          due_at: string | null
          reminder_at: string | null
          reminder_sent: boolean
          status: TaskStatus
          completed_at: string | null
          completed_by: string | null
          parent_task_id: string | null
          equipment_id: string | null
          source: TaskSource
          source_ref: string | null
          crop_year: number
          created_at: string
        }
        Insert: {
          id?: string
          title: string
          description_md?: string | null
          field_id?: string | null
          assigned_to?: string | null
          created_by?: string
          due_at?: string | null
          reminder_at?: string | null
          reminder_sent?: boolean
          status?: TaskStatus
          completed_at?: string | null
          completed_by?: string | null
          parent_task_id?: string | null
          equipment_id?: string | null
          source?: TaskSource
          source_ref?: string | null
          crop_year?: number
          created_at?: string
        }
        Update: {
          id?: string
          title?: string
          description_md?: string | null
          field_id?: string | null
          assigned_to?: string | null
          created_by?: string
          due_at?: string | null
          reminder_at?: string | null
          reminder_sent?: boolean
          status?: TaskStatus
          completed_at?: string | null
          completed_by?: string | null
          parent_task_id?: string | null
          equipment_id?: string | null
          source?: TaskSource
          source_ref?: string | null
          crop_year?: number
          created_at?: string
        }
        Relationships: []
      }
      task_files: {
        Row: {
          id: string
          task_id: string
          storage_path: string
          filename: string
          uploaded_by: string | null
          uploaded_at: string
        }
        Insert: {
          id?: string
          task_id: string
          storage_path: string
          filename: string
          uploaded_by?: string | null
          uploaded_at?: string
        }
        Update: {
          id?: string
          task_id?: string
          storage_path?: string
          filename?: string
          uploaded_by?: string | null
          uploaded_at?: string
        }
        Relationships: []
      }
      /**
       * One reading off the Model 919, against the field's crop.
       *
       * moisture_pct is STORED rather than recomputed from the reading: a chart
       * can be revised and the crop's grade bands are editable, but what that
       * sample read on that day must not move underneath the record.
       */
      moisture_tests: {
        Row: {
          id: string
          tested_at: string
          crop_year: number
          field_id: string | null
          crop_id: string | null
          bin_id: string | null
          temperature_c: number | null
          meter_reading: number | null
          chart_key: string | null
          sample_weight_g: number | null
          moisture_pct: number
          grade: 'too_dry' | 'dry' | 'tough' | 'damp' | 'moist' | 'wet' | null
          /** The percentage was typed in, not read off our own meter. */
          entered_by_hand: boolean
          note: string | null
          /** screened = cleaned before testing; dirty = tested as it came off. */
          sample_condition: 'screened' | 'dirty' | null
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          tested_at?: string
          crop_year: number
          field_id?: string | null
          crop_id?: string | null
          bin_id?: string | null
          temperature_c?: number | null
          meter_reading?: number | null
          chart_key?: string | null
          sample_weight_g?: number | null
          moisture_pct: number
          grade?: 'too_dry' | 'dry' | 'tough' | 'damp' | 'moist' | 'wet' | null
          entered_by_hand?: boolean
          note?: string | null
          sample_condition?: 'screened' | 'dirty' | null
          created_by?: string | null
        }
        Update: Partial<Database['public']['Tables']['moisture_tests']['Insert']>
        Relationships: []
      }
      /**
       * A bin that went up tough and has not had air put on it.
       *
       * Raised by the database, not the client: the two halves — a wet sample
       * and a finished harvest — arrive in either order and often days apart,
       * and neither browser is necessarily open when the second one lands.
       */
      /**
       * What is sitting in a bin. One OPEN row per bin, enforced by a unique
       * index — a bin holds one thing at a time, and closing the row with
       * emptied_on is how it becomes available again.
       */
      bin_contents: {
        Row: {
          id: string
          bin_id: string
          crop_id: string | null
          variety: string | null
          /** The season the grain was GROWN. Carry-over is read off this. */
          crop_year: number
          bushels: number | null
          note: string | null
          filled_on: string | null
          /** Null while it is still in there. */
          emptied_on: string | null
          created_at: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          id?: string
          bin_id: string
          crop_id?: string | null
          variety?: string | null
          crop_year: number
          bushels?: number | null
          note?: string | null
          filled_on?: string | null
          emptied_on?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: Partial<Database['public']['Tables']['bin_contents']['Insert']>
        Relationships: []
      }
      bin_air_alerts: {
        Row: {
          id: string
          field_id: string
          crop_year: number
          crop_id: string | null
          bin_id: string | null
          moisture_test_id: string | null
          moisture_pct: number
          grade: string
          raised_at: string
          dismissed_at: string | null
          dismissed_by: string | null
          dismissed_note: string | null
        }
        /** Raised by fn_raise_bin_air, never by the client. */
        Insert: never
        Update: {
          dismissed_at?: string | null
          dismissed_by?: string | null
          dismissed_note?: string | null
        }
        Relationships: []
      }
      notifications: {
        Row: {
          id: string
          user_id: string
          kind: string
          title: string
          body: string | null
          link: string | null
          read_at: string | null
          created_at: string
          /** Context from whatever raised it (values, error text, what changed). */
          details: Json | null
        }
        Insert: never
        Update: {
          read_at?: string | null
        }
        Relationships: []
      }
      /** Conference-room TV queue. Node-RED claims and completes rows with the service role. */
      tv_commands: {
        Row: {
          id: string
          command: 'show_app' | 'show_firestick' | 'tv_off'
          url: string | null
          requested_by: string
          status: 'pending' | 'claimed' | 'done' | 'failed'
          error: string | null
          created_at: string
          claimed_at: string | null
          handled_at: string | null
        }
        Insert: {
          command: 'show_app' | 'show_firestick' | 'tv_off'
          url?: string | null
        }
        Update: never
        Relationships: []
      }
      notification_prefs: {
        Row: {
          id: string
          user_id: string
          kind: string
          in_app: boolean
          email: boolean
        }
        Insert: {
          id?: string
          user_id: string
          kind: string
          in_app?: boolean
          email?: boolean
        }
        Update: {
          id?: string
          user_id?: string
          kind?: string
          in_app?: boolean
          email?: boolean
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          id: string
          user_id: string
          endpoint: string
          p256dh: string
          auth: string
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          endpoint: string
          p256dh: string
          auth: string
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          endpoint?: string
          p256dh?: string
          auth?: string
          created_at?: string
        }
        Relationships: []
      }
      cattle_groups: {
        Row: {
          id: string
          name: string
          notes_md: string | null
          active: boolean
          ranch_id: string | null
          avg_weight_lb: number | null
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          notes_md?: string | null
          active?: boolean
          ranch_id?: string | null
          avg_weight_lb?: number | null
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          notes_md?: string | null
          active?: boolean
          ranch_id?: string | null
          avg_weight_lb?: number | null
          created_at?: string
        }
        Relationships: []
      }
      ranches: {
        Row: {
          id: string
          name: string
          sort_order: number
          grazing_utilization_rate: number
          grazing_precip_mm: number
          /** This ranch's own Google My Map; its "Pasture …" shapes become this ranch's pastures. */
          mymaps_url: string | null
          latitude: number | null
          longitude: number | null
          precip_start_month: number
          precip_end_month: number
          precip_auto: boolean
          river_alert_cms: number | null
          bow_alert_cms: number | null
          /** Manifest details: Alberta PID, brand and where it sits. */
          premises_id: string | null
          brand: string | null
          brand_location: string | null
          address: string | null
          owner_name: string | null
          owner_phone: string | null
          created_at: string
          /** When the bulls went in with the cows this season. */
          bulls_in_on: string | null
          bulls_out_on: string | null
          /** Bulls in with the replacement heifers, when not the cows' date. */
          heifer_bulls_in_on: string | null
          /** Pasture move-out check thresholds (see pasture-move.ts). */
          move_alerts_on: boolean
          move_days_left_min: number
          move_forage_index_min: number
          move_decline_pct: number
          move_dry_pct: number
          /** This season's weaning day (calves at side until then). */
          weaning_date: string | null
          /** Move-out check counts the calves at side with their cows until weaning. */
          move_count_calves: boolean
          calf_sale_month: number | null
          /** Null: the average of this ranch's own sales. */
          steer_sale_weight_lb: number | null
          heifer_sale_weight_lb: number | null
        }
        Insert: {
          id?: string
          name: string
          sort_order?: number
          grazing_utilization_rate?: number
          grazing_precip_mm?: number
          latitude?: number | null
          longitude?: number | null
        }
        Update: {
          name?: string
          sort_order?: number
          grazing_utilization_rate?: number
          grazing_precip_mm?: number
          mymaps_url?: string | null
          latitude?: number | null
          longitude?: number | null
          precip_start_month?: number
          precip_end_month?: number
          precip_auto?: boolean
          river_alert_cms?: number | null
          bow_alert_cms?: number | null
          premises_id?: string | null
          brand?: string | null
          brand_location?: string | null
          address?: string | null
          owner_name?: string | null
          owner_phone?: string | null
          bulls_in_on?: string | null
          bulls_out_on?: string | null
          heifer_bulls_in_on?: string | null
          move_alerts_on?: boolean
          move_days_left_min?: number
          move_forage_index_min?: number
          move_decline_pct?: number
          move_dry_pct?: number
          weaning_date?: string | null
          move_count_calves?: boolean
          calf_sale_month?: number | null
          steer_sale_weight_lb?: number | null
          heifer_sale_weight_lb?: number | null
        }
        Relationships: []
      }
      feed_plans: {
        Row: {
          id: string
          ranch_id: string
          start_month: number | null
          start_day: number | null
          end_month: number | null
          end_day: number | null
          dmi_pct: number
          hay_dm_pct: number
          silage_dm_pct: number
          waste_pct: number
          hay_bale_lb: number
          excluded_group_ids: string[]
          ration_confirmed: boolean
          updated_at: string
          calving_month: number
          calving_day: number
          coat: 'wet' | 'fall' | 'winter' | 'heavy'
          sheltered: boolean
          muddy: boolean
          reserve_pct: number
          /** feed_types ids this ranch doesn't normally feed (hidden from its pick lists). */
          feeds_not_used: string[]
        }
        Insert: { id?: string; ranch_id: string }
        Update: {
          start_month?: number | null
          start_day?: number | null
          end_month?: number | null
          end_day?: number | null
          dmi_pct?: number
          hay_dm_pct?: number
          silage_dm_pct?: number
          waste_pct?: number
          hay_bale_lb?: number
          excluded_group_ids?: string[]
          ration_confirmed?: boolean
          updated_at?: string
          calving_month?: number
          calving_day?: number
          coat?: 'wet' | 'fall' | 'winter' | 'heavy'
          sheltered?: boolean
          muddy?: boolean
          reserve_pct?: number
          feeds_not_used?: string[]
        }
        Relationships: []
      }
      feed_ration: {
        Row: {
          id: string
          ranch_id: string
          crop_id: string
          dm_share_pct: number
          sort_order: number
          updated_at: string
        }
        Insert: { id?: string; ranch_id: string; crop_id: string; dm_share_pct?: number; sort_order?: number }
        Update: { dm_share_pct?: number; sort_order?: number; updated_at?: string }
        Relationships: []
      }
      cattle: {
        Row: {
          id: string
          tag: string | null
          name: string | null
          sex: CattleSex | null
          breed: string | null
          birth_date: string | null
          dam_tag: string | null
          sire_tag: string | null
          status: CattleStatus
          group_id: string | null
          ranch_id: string | null
          location: string | null
          acquired_date: string | null
          notes_md: string | null
          created_at: string
        }
        Insert: {
          id?: string
          tag?: string | null
          name?: string | null
          sex?: CattleSex | null
          breed?: string | null
          birth_date?: string | null
          dam_tag?: string | null
          sire_tag?: string | null
          status?: CattleStatus
          group_id?: string | null
          ranch_id?: string | null
          location?: string | null
          acquired_date?: string | null
          notes_md?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          tag?: string | null
          name?: string | null
          sex?: CattleSex | null
          breed?: string | null
          birth_date?: string | null
          dam_tag?: string | null
          sire_tag?: string | null
          status?: CattleStatus
          group_id?: string | null
          ranch_id?: string | null
          location?: string | null
          acquired_date?: string | null
          notes_md?: string | null
          created_at?: string
        }
        Relationships: []
      }
      cattle_events: {
        Row: {
          id: string
          cattle_id: string | null
          group_id: string | null
          event_type: CattleEventType
          event_date: string
          weight_lb: number | null
          product: string | null
          dose: string | null
          location: string | null
          notes: string | null
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          cattle_id?: string | null
          group_id?: string | null
          event_type: CattleEventType
          event_date?: string
          weight_lb?: number | null
          product?: string | null
          dose?: string | null
          location?: string | null
          notes?: string | null
          created_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          cattle_id?: string | null
          group_id?: string | null
          event_type?: CattleEventType
          event_date?: string
          weight_lb?: number | null
          product?: string | null
          dose?: string | null
          location?: string | null
          notes?: string | null
          created_by?: string | null
          created_at?: string
        }
        Relationships: []
      }
      financial_entries: {
        Row: {
          id: string
          crop_year: number
          entry_date: string
          kind: FinancialKind
          category: string | null
          amount: number
          crop_id: string | null
          field_id: string | null
          contact_id: string | null
          description: string | null
          source: string
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          crop_year?: number
          entry_date?: string
          kind: FinancialKind
          category?: string | null
          amount: number
          crop_id?: string | null
          field_id?: string | null
          contact_id?: string | null
          description?: string | null
          source?: string
          created_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          crop_year?: number
          entry_date?: string
          kind?: FinancialKind
          category?: string | null
          amount?: number
          crop_id?: string | null
          field_id?: string | null
          contact_id?: string | null
          description?: string | null
          source?: string
          created_by?: string | null
          created_at?: string
        }
        Relationships: []
      }
      weather_stations: {
        Row: {
          ltn_file: string | null
          id: string
          name: string
          lat: number
          lon: number
          elevation_m: number
          data_available_till: string | null
          active: boolean
        }
        Insert: {
          ltn_file?: string | null
          id?: string
          name: string
          lat: number
          lon: number
          elevation_m: number
          active?: boolean
        }
        Update: { name?: string; active?: boolean; data_available_till?: string | null }
        Relationships: []
      }
      crop_coefficients: {
        Row: {
          aimm_crop_id: number | null
          water_use_scale: number
          id: string
          crop: string
          variant: string
          kc_ini: number
          kc_mid: number
          kc_end: number
          l_ini: number
          l_dev: number
          l_mid: number
          l_late: number
          zr_max_m: number
          p_depletion: number
          active: boolean
        }
        Insert: {
          aimm_crop_id?: number | null
          water_use_scale?: number
          id?: string
          crop: string
          variant?: string
          kc_ini: number
          kc_mid: number
          kc_end: number
          l_ini: number
          l_dev: number
          l_mid: number
          l_late: number
          zr_max_m: number
          p_depletion: number
          active?: boolean
        }
        Update: Partial<Database['public']['Tables']['crop_coefficients']['Insert']>
        Relationships: []
      }
      field_crop_seasons: {
        Row: {
          calibration_factor: number
          calibration_note: string | null
          start_moisture_mm: number | null
          start_moisture_on: string | null
          harvest_date: string | null
          id: string
          field_id: string
          crop_year: number
          zone_id: string | null
          crop_coefficient_id: string | null
          planting_date: string | null
          system_type: string | null
          system_capacity_mm_day: number | null
          application_efficiency: number
          active: boolean
          kc_mode: string | null
          planting_date_source: string | null
          planting_date_synced_at: string | null
          irrigation_done_at: string | null
          irrigation_done_by: string | null
        }
        Insert: {
          calibration_factor?: number
          calibration_note?: string | null
          start_moisture_mm?: number | null
          start_moisture_on?: string | null
          harvest_date?: string | null
          id?: string
          field_id: string
          crop_year: number
          zone_id?: string | null
          crop_coefficient_id?: string | null
          planting_date?: string | null
          system_type?: string | null
          system_capacity_mm_day?: number | null
          application_efficiency?: number
          active?: boolean
          kc_mode?: string | null
          planting_date_source?: string | null
          planting_date_synced_at?: string | null
          irrigation_done_at?: string | null
          irrigation_done_by?: string | null
        }
        Update: {
          calibration_factor?: number
          calibration_note?: string | null
          start_moisture_mm?: number | null
          start_moisture_on?: string | null
          harvest_date?: string | null
          zone_id?: string | null
          crop_coefficient_id?: string | null
          planting_date?: string | null
          system_type?: string | null
          system_capacity_mm_day?: number | null
          application_efficiency?: number
          active?: boolean
          kc_mode?: string | null
          planting_date_source?: string | null
          planting_date_synced_at?: string | null
          irrigation_done_at?: string | null
          irrigation_done_by?: string | null
        }
        Relationships: []
      }
      soil_test_reports: {
        Row: {
          id: string
          field_id: string
          crop_year: number
          part_label: string
          crop_label: string | null
          lab: string | null
          report_ref: string | null
          report_date: string | null
          source_file: string | null
          source_page: number | null
          created_at: string
        }
        Insert: {
          id?: string
          field_id: string
          crop_year: number
          part_label?: string
          crop_label?: string | null
          lab?: string | null
          report_ref?: string | null
          report_date?: string | null
          source_file?: string | null
          source_page?: number | null
        }
        Update: Partial<Database['public']['Tables']['soil_test_reports']['Insert']>
        Relationships: []
      }
      soil_test_samples: {
        Row: {
          id: string
          report_id: string
          sample_code: string
          depth_label: string | null
          depth_top_in: number | null
          depth_bottom_in: number | null
          om_pct: number | null
          no3n_ppm: number | null
          no3n_lb_ac: number | null
          p_bicarb_ppm: number | null
          p_melich3_ppm: number | null
          k_ppm: number | null
          so4s_ppm: number | null
          ph: number | null
          cec_meq: number | null
          base_k_pct: number | null
          base_mg_pct: number | null
          base_ca_pct: number | null
          base_h_pct: number | null
          base_na_pct: number | null
          mg_ppm: number | null
          ca_ppm: number | null
          na_ppm: number | null
          zn_ppm: number | null
          mn_ppm: number | null
          fe_ppm: number | null
          cu_ppm: number | null
          b_ppm: number | null
          soluble_salts: number | null
          p_sat_pct: number | null
          al_ppm: number | null
          al_sat_pct: number | null
          k_mg_ratio: number | null
          cl_ppm: number | null
          ec_ms_cm: number | null
          enr: number | null
          gfi: number | null
        }
        Insert: Partial<Database['public']['Tables']['soil_test_samples']['Row']> & {
          report_id: string
          sample_code: string
        }
        Update: Partial<Database['public']['Tables']['soil_test_samples']['Row']>
        Relationships: []
      }
      soil_test_assessments: {
        Row: {
          id: string
          report_id: string
          crop_label: string | null
          assessment_md: string
          recommendation: Json
          column_notes: Json
          model: string | null
          generated_at: string
          generated_by: string | null
        }
        Insert: {
          id?: string
          report_id: string
          crop_label?: string | null
          assessment_md: string
          recommendation?: Json
          column_notes?: Json
          model?: string | null
          generated_by?: string | null
        }
        Update: Partial<Database['public']['Tables']['soil_test_assessments']['Insert']>
        Relationships: []
      }
      irrigation_events: {
        Row: {
          coverage_deg: number | null
          note: string | null
          id: string
          field_id: string
          zone_id: string | null
          date: string
          gross_mm: number | null
          net_mm: number | null
          source: string
          fieldnet_ref: string | null
          created_by: string | null
          created_at: string
          /** What the source said, before any correction. */
          source_gross_mm: number | null
          /** A person's correction; gross_mm follows it while set. */
          adjusted_gross_mm: number | null
          adjusted_note: string | null
          adjusted_by: string | null
          adjusted_at: string | null
        }
        Insert: {
          coverage_deg?: number | null
          note?: string | null
          id?: string
          field_id: string
          zone_id?: string | null
          date?: string
          gross_mm?: number | null
          net_mm?: number | null
          source?: string
          fieldnet_ref?: string | null
          created_by?: string | null
        }
        Update: {
          gross_mm?: number | null
          net_mm?: number | null
          adjusted_gross_mm?: number | null
          adjusted_note?: string | null
          adjusted_by?: string | null
          adjusted_at?: string | null
        }
        Relationships: []
      }
      water_balance_daily: {
        Row: {
          rain_source: string | null
          runoff_mm: number | null
          ks: number | null
          field_id: string
          zone_id: string | null
          date: string
          etc_mm: number | null
          dr_mm: number | null
          taw_mm: number | null
          raw_mm: number | null
          zr_m: number | null
          kc: number | null
          status: string | null
          rec_net_mm: number | null
          rec_gross_mm: number | null
          days_to_irrigate: number | null
          is_forecast: boolean
          avail_100_mm: number | null
          avail_50_mm: number | null
          over_irrigation_mm: number | null
          lost_precip_mm: number | null
          rainfall_mm: number | null
          effective_irrigation_mm: number | null
        }
        Insert: never
        Update: never
        Relationships: []
      }
      pumps: {
        Row: {
          id: string
          farm_id: string | null
          name: string
          legal_land: string | null
          lat: number | null
          lon: number | null
          water_priority_number: string | null
          horse_power: number | null
          voltage: number | null
          brand: string | null
          model: string | null
          serial_number: string | null
          gpm: number | null
          kind: string
          meter_units: string | null
          notes: string | null
          created_at: string
          impeller_in: number | null
          motor_brand: string | null
          motor_id: string | null
          motor_frame: string | null
          motor_type: string | null
          phase: number | null
          hz: number | null
          amps: number | null
          rpm: number | null
          service_factor: number | null
          efficiency_pct: number | null
          nema_design: string | null
          kva_code: string | null
          insulation_class: string | null
          ambient: string | null
          bearing_shaft_end: string | null
          bearing_opp_end: string | null
          /** Estimated from the pump curve; gpm is for a measured flow. */
          gpm_estimate: number | null
          gpm_estimate_low: number | null
          gpm_estimate_high: number | null
          gpm_basis: string | null
          serviced_by_contact_id: string | null
          updated_at: string
          /** The control panel (starter) beside the pump. */
          panel_maker: string | null
          panel_type: string | null
          panel_catalogue: string | null
          panel_shop_order: string | null
          panel_hp: number | null
          panel_main_volts: number | null
          panel_control_volts: number | null
          panel_interrupting_ka: number | null
          panel_enclosure_rating: string | null
          panel_main_breaker: string | null
          panel_breaker_amps: number | null
          panel_starter_size: string | null
          panel_overload_heaters: string | null
          panel_cable_size: string | null
          panel_meter_socket: string | null
          panel_fuse: string | null
          panel_coil: string | null
          panel_enclosure_part: string | null
          panel_selector: string | null
          panel_extras: string | null
          panel_drawing_date: string | null
          panel_note: string | null
          equipment_flags: string | null
          panel_parts_basis: string | null
          power_factor_pct: number | null
          max_kvar: number | null
          motor_part_number: string | null
          plate_code: string | null
          motor_catalogue: string | null
          motor_spec: string | null
          motor_serial: string | null
          motor_enclosure: string | null
          motor_wiring: string | null
          supply_volts: number | null
          stages: number | null
          rotation: string | null
          discharge_head: string | null
          panel_model: string | null
          /** 'irrigation' (default) or e.g. 'gravel pit'. Only irrigation pumps go on a pivot. */
          purpose: string
          power_utility: string | null
          power_meter_number: string | null
          power_meter_model: string | null
          power_meter_module: string | null
          power_meter_details: string | null
          power_meter_reading_kwh: number | null
          power_meter_read_on: string | null
          power_meter_shared_with: string | null
        }
        Insert: {
          id?: string
          farm_id?: string | null
          name: string
          legal_land?: string | null
          lat?: number | null
          lon?: number | null
          water_priority_number?: string | null
          horse_power?: number | null
          voltage?: number | null
          brand?: string | null
          model?: string | null
          serial_number?: string | null
          gpm?: number | null
          kind?: string
          meter_units?: string | null
          notes?: string | null
          impeller_in?: number | null
          motor_brand?: string | null
          motor_id?: string | null
          motor_frame?: string | null
          motor_type?: string | null
          phase?: number | null
          hz?: number | null
          amps?: number | null
          rpm?: number | null
          service_factor?: number | null
          efficiency_pct?: number | null
          nema_design?: string | null
          kva_code?: string | null
          insulation_class?: string | null
          ambient?: string | null
          bearing_shaft_end?: string | null
          bearing_opp_end?: string | null
          /** Estimated from the pump curve; gpm is for a measured flow. */
          gpm_estimate?: number | null
          gpm_estimate_low?: number | null
          gpm_estimate_high?: number | null
          gpm_basis?: string | null
          serviced_by_contact_id?: string | null
          updated_at?: string
          panel_maker?: string | null
          panel_type?: string | null
          panel_catalogue?: string | null
          panel_shop_order?: string | null
          panel_hp?: number | null
          panel_main_volts?: number | null
          panel_control_volts?: number | null
          panel_interrupting_ka?: number | null
          panel_enclosure_rating?: string | null
          panel_main_breaker?: string | null
          panel_breaker_amps?: number | null
          panel_starter_size?: string | null
          panel_overload_heaters?: string | null
          panel_cable_size?: string | null
          panel_meter_socket?: string | null
          panel_fuse?: string | null
          panel_coil?: string | null
          panel_enclosure_part?: string | null
          panel_selector?: string | null
          panel_extras?: string | null
          panel_drawing_date?: string | null
          panel_note?: string | null
          equipment_flags?: string | null
          panel_parts_basis?: string | null
          power_factor_pct?: number | null
          max_kvar?: number | null
          motor_part_number?: string | null
          plate_code?: string | null
          motor_catalogue?: string | null
          motor_spec?: string | null
          motor_serial?: string | null
          motor_enclosure?: string | null
          motor_wiring?: string | null
          supply_volts?: number | null
          stages?: number | null
          rotation?: string | null
          discharge_head?: string | null
          panel_model?: string | null
          purpose?: string
          power_utility?: string | null
          power_meter_number?: string | null
          power_meter_model?: string | null
          power_meter_module?: string | null
          power_meter_details?: string | null
          power_meter_reading_kwh?: number | null
          power_meter_read_on?: string | null
          power_meter_shared_with?: string | null
        }
        Update: Partial<Database['public']['Tables']['pumps']['Insert']>
        Relationships: []
      }
      pump_photos: {
        Row: {
          id: string
          pump_id: string
          caption: string | null
          filename: string | null
          mime: string
          image_b64: string
          width: number | null
          height: number | null
          bytes: number | null
          source: string
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          pump_id: string
          caption?: string | null
          filename?: string | null
          mime?: string
          image_b64: string
          width?: number | null
          height?: number | null
          bytes?: number | null
          source?: string
        }
        Update: Partial<Database['public']['Tables']['pump_photos']['Insert']>
        Relationships: []
      }
      /** Provincial grazing leases; the standing facts each year's stock return repeats. */
      grazing_dispositions: {
        Row: {
          id: string
          ranch_id: string | null
          disposition_no: string
          holder_name: string | null
          holder_address: string | null
          expiry_date: string | null
          key_land: string | null
          billable_aum: number | string | null
          capacity_aum: number | string | null
          return_to: string | null
          return_phone: string | null
          return_fax: string | null
          pasture_unit: string | null
          pasture_ids: string[]
          /** [{land_type, acres, quarter, section, township, range, meridian}] */
          other_lands: Json
          /** [{owner, description, location, livestock}] */
          brands: Json
          calving_months: string | null
          signer_name: string | null
          phone: string | null
          email: string | null
          notes: string | null
          active: boolean
          sort_order: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          ranch_id?: string | null
          disposition_no: string
          holder_name?: string | null
          holder_address?: string | null
          expiry_date?: string | null
          key_land?: string | null
          billable_aum?: number | null
          capacity_aum?: number | null
          return_to?: string | null
          return_phone?: string | null
          return_fax?: string | null
          pasture_unit?: string | null
          pasture_ids?: string[]
          other_lands?: Json
          brands?: Json
          calving_months?: string | null
          signer_name?: string | null
          phone?: string | null
          email?: string | null
          notes?: string | null
          active?: boolean
          sort_order?: number
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['grazing_dispositions']['Insert']>
        Relationships: []
      }
      /** One Stewardship Stock Return a grazing lease a year. */
      grazing_disposition_returns: {
        Row: {
          id: string
          disposition_id: string
          year: number
          grazed: boolean | null
          livestock: Json
          weights: Json
          owned: boolean | null
          owned_explain: string | null
          hay_cut: boolean | null
          hay: Json
          feed_supplied: boolean | null
          feed: Json
          other_fenced: boolean | null
          had_losses: boolean | null
          losses: Json
          declared: boolean
          signed_on: string | null
          status: 'draft' | 'filed'
          filed_on: string | null
          /** {section: "from the app"}: filled by the app, not yet checked. */
          prefilled: Json
          notes: string | null
          created_at: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          id?: string
          disposition_id: string
          year: number
          grazed?: boolean | null
          livestock?: Json
          weights?: Json
          owned?: boolean | null
          owned_explain?: string | null
          hay_cut?: boolean | null
          hay?: Json
          feed_supplied?: boolean | null
          feed?: Json
          other_fenced?: boolean | null
          had_losses?: boolean | null
          losses?: Json
          declared?: boolean
          signed_on?: string | null
          status?: 'draft' | 'filed'
          filed_on?: string | null
          prefilled?: Json
          notes?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: Partial<Database['public']['Tables']['grazing_disposition_returns']['Insert']>
        Relationships: []
      }
      pivot_photos: {
        Row: {
          id: string
          pivot_id: string
          caption: string | null
          filename: string | null
          mime: string
          image_b64: string
          width: number | null
          height: number | null
          bytes: number | null
          source: string
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          pivot_id: string
          caption?: string | null
          filename?: string | null
          mime?: string
          image_b64: string
          width?: number | null
          height?: number | null
          bytes?: number | null
          source?: string
        }
        Update: Partial<Database['public']['Tables']['pivot_photos']['Insert']>
        Relationships: []
      }
      mineral_programs: {
        Row: {
          id: string
          ranch_id: string
          product: string
          quantity: number
          unit: string
          per: 'month' | 'season'
          when_fed: string | null
          supplier_contact_id: string | null
          /** $ a unit (a tub); null until a receipt shows it. */
          price_each: number | null
          notes: string | null
          updated_at: string
        }
        Insert: {
          id?: string
          ranch_id: string
          product?: string
          quantity: number
          unit?: string
          per: 'month' | 'season'
          when_fed?: string | null
          supplier_contact_id?: string | null
          price_each?: number | null
          notes?: string | null
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['mineral_programs']['Insert']>
        Relationships: []
      }
      jd_field_operations: {
        Row: {
          id: string
          jd_id: string
          field_id: string | null
          operation_type: string | null
          crop_season: number | null
          started_at: string | null
          ended_at: string | null
          treated_crop: string | null
          operator_name: string | null
          operator_jd_id: string | null
          machine_id: string | null
          machine_vin: string | null
          products: Json
          raw: Json | null
          /** Deere's measurement replies, verbatim. The columns below read from them. */
          conditions: Json | null
          /** Numerics arrive as strings through PostgREST; callers must coerce. */
          wind_speed_kmh: number | string | null
          wind_gust_kmh: number | string | null
          wind_dir_deg: number | null
          air_temp_c: number | string | null
          humidity_pct: number | string | null
          app_speed_kmh: number | string | null
          conditions_at: string | null
          /** 'ecmwf' is modelled weather at the field, 'deere' is off the machine. */
          conditions_source: 'deere' | 'ecmwf' | 'none' | null
          /** The instant the weather describes; not always the pass midpoint. */
          weather_at: string | null
          /** Ground actually covered — routinely less than the field. */
          applied_area_ha: number | string | null
          /** Per product: what the machine measured itself putting out. */
          as_applied: Json | null
          /** From the per-point export: the sittings, [] when Deere logged no points. Null until read. */
          sessions: Json | null
          work_minutes: number | string | null
          sessions_at: string | null
          sessions_note: string | null
          /** Fuel the machine logged while working the pass (Σ FUEL off the per-point export), litres. Null until read. */
          fuel_l: number | string | null
          fuel_read_at: string | null
          synced_at: string
          /** Another record of a job already counted; hidden from reads by RLS. */
          duplicate_of: string | null
          duplicate_reason: string | null
          duplicate_by: 'auto' | 'user' | null
          not_duplicate: boolean
          /** Acres to cost this pass on, set by hand. */
          cost_acres_override: number | string | null
          /** Somebody else's crop: 'custom_work' (renter's section) or 'rented_out' (whole field). Not our cost. */
          not_ours: 'custom_work' | 'rented_out' | null
          not_ours_by: 'auto' | 'user' | null
          not_ours_note: string | null
          /** 'pending': hand-entered with nothing logged, hidden until confirmed. */
          confirm_status: 'pending' | 'confirmed' | null
          products_corrected: Json | null
          correction_note: string | null
          /** 'deere' = synced; 'app' = added in the app (ICI's floated Edge). */
          source: 'deere' | 'app'
          source_ref: string | null
        }
        Insert: { jd_id: string; field_id?: string | null }
        Update: Partial<Database['public']['Tables']['jd_field_operations']['Insert']> & {
          sessions?: Json | null
          work_minutes?: number | null
          sessions_at?: string | null
          sessions_note?: string | null
          cost_acres_override?: number | null
          fuel_l?: number | null
          fuel_read_at?: string | null
        }
        Relationships: []
      }
      /** Shared numbers for distances, fuel, trucking and spreading. A missing key = the stated default. */
      operating_settings: {
        Row: { id: string; key: string; value: Json; updated_by: string | null; updated_at: string }
        Insert: { id?: string; key: string; value: Json; updated_by?: string | null; updated_at?: string }
        Update: { id?: string; key?: string; value?: Json; updated_by?: string | null; updated_at?: string }
        Relationships: []
      }
      /** One fuel line off a Fuel supplier invoice (or typed): litres and $/L before GST. */
      fuel_purchases: {
        Row: {
          id: string
          supplier: string
          invoice_no: string | null
          invoice_date: string
          product: string
          description: string | null
          litres: number | string
          price_per_l: number | string
          amount: number | string | null
          checked: boolean
          source: string
          source_file: string | null
          notes: string | null
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          supplier?: string
          invoice_no?: string | null
          invoice_date: string
          product: string
          description?: string | null
          litres: number
          price_per_l: number
          amount?: number | null
          checked?: boolean
          source?: string
          source_file?: string | null
          notes?: string | null
          created_by?: string | null
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['fuel_purchases']['Insert']>
        Relationships: []
      }
      /**
       * Distance and time between two places ('shop', 'bins', 'field:<id>' = the
       * field's entry, 'site:<id>'; 'yard' is the old name for the bins), from
       * the road router and the farm trails, with how it was made.
       */
      road_routes: {
        Row: {
          id: string
          from_key: string
          to_key: string
          from_lat: number
          from_lng: number
          to_lat: number
          to_lng: number
          distance_km: number | string
          duration_min: number | string
          source: string
          computed_at: string
          road_km: number | string | null
          trail_km: number | string | null
          connector_km: number | string | null
          method: string | null
          approach_lat: number | null
          approach_lng: number | null
          trail_path: Json | null
          entry_basis: string | null
          note: string | null
        }
        Insert: {
          id?: string
          from_key: string
          to_key: string
          from_lat: number
          from_lng: number
          to_lat: number
          to_lng: number
          distance_km: number
          duration_min: number
          source?: string
          computed_at?: string
          road_km?: number | null
          trail_km?: number | null
          connector_km?: number | null
          method?: string | null
          approach_lat?: number | null
          approach_lng?: number | null
          trail_path?: Json | null
          entry_basis?: string | null
          note?: string | null
        }
        Update: Partial<Database['public']['Tables']['road_routes']['Insert']>
        Relationships: []
      }
      /** The router's answer for a point from an origin: where it met the road, and the road to it. A cache. */
      road_snaps: {
        Row: {
          id: string
          from_key: string
          from_lat: number
          from_lng: number
          lat: number
          lng: number
          snap_lat: number | null
          snap_lng: number | null
          snap_m: number | string | null
          road_km: number | string | null
          road_min: number | string | null
          computed_at: string
        }
        Insert: {
          id?: string
          from_key: string
          from_lat: number
          from_lng: number
          lat: number
          lng: number
          snap_lat?: number | null
          snap_lng?: number | null
          snap_m?: number | null
          road_km?: number | null
          road_min?: number | null
          computed_at?: string
        }
        Update: Partial<Database['public']['Tables']['road_snaps']['Insert']>
        Relationships: []
      }
      /** Where the machines go into a field, as a person set it. */
      field_entries: {
        Row: { id: string; field_id: string; lat: number; lng: number; note: string | null; set_by: string | null; updated_at: string }
        Insert: { id?: string; field_id: string; lat: number; lng: number; note?: string | null; set_by?: string | null; updated_at?: string }
        Update: Partial<Database['public']['Tables']['field_entries']['Insert']>
        Relationships: []
      }
      /** Farm trails drawn on the Distances map (geom is a LineString; write it as EWKT). */
      farm_trails: {
        Row: { id: string; name: string; geom: unknown; note: string | null; source: string; created_by: string | null; updated_at: string }
        Insert: { id?: string; name: string; geom: string; note?: string | null; source?: string; created_by?: string | null; updated_at?: string }
        Update: Partial<Database['public']['Tables']['farm_trails']['Insert']>
        Relationships: []
      }
      /** Where a field's crop goes when it comes off, per year. */
      field_haul_plans: {
        Row: {
          id: string
          field_id: string
          crop_year: number
          mode: 'direct' | 'bin_yard' | 'bin_yard_then_elevator' | 'buyer_pickup'
          delivery_site_id: string | null
          notes: string | null
          updated_by: string | null
          updated_at: string
        }
        Insert: {
          id?: string
          field_id: string
          crop_year: number
          mode: 'direct' | 'bin_yard' | 'bin_yard_then_elevator' | 'buyer_pickup'
          delivery_site_id?: string | null
          notes?: string | null
          updated_by?: string | null
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['field_haul_plans']['Insert']>
        Relationships: []
      }
      /** A custom manure hauler's invoice line, tied to the spread it paid for. Amount is before GST. */
      manure_haul_invoices: {
        Row: {
          id: string
          manure_application_id: string | null
          field_id: string | null
          hauler: string
          invoice_no: string | null
          invoice_date: string | null
          work_date: string | null
          description: string | null
          hours: number | string | null
          rate_per_hour: number | string | null
          amount: number | string
          gst: number | string | null
          loads: number | null
          tonnes: number | string | null
          notes: string | null
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          manure_application_id?: string | null
          field_id?: string | null
          hauler: string
          invoice_no?: string | null
          invoice_date?: string | null
          work_date?: string | null
          description?: string | null
          hours?: number | null
          rate_per_hour?: number | null
          amount: number
          gst?: number | null
          loads?: number | null
          tonnes?: number | null
          notes?: string | null
          created_by?: string | null
          created_at?: string
        }
        Update: Partial<Database['public']['Tables']['manure_haul_invoices']['Insert']>
        Relationships: []
      }
      /** My Map features the cattle map leaves out (true) or draws against the rule (false). */
      mymap_hidden_features: {
        Row: { key: string; layer: string; name: string | null; hidden: boolean; hidden_at: string; hidden_by: string | null }
        Insert: { key: string; layer: string; name?: string | null; hidden?: boolean; hidden_by?: string | null }
        Update: { hidden?: boolean }
        Relationships: []
      }
      /** Approved time off from the time-off calendar feed; ends_on is exclusive. */
      time_off: {
        Row: {
          uid: string
          who: string
          kind: string
          summary: string
          reason: string | null
          starts_on: string
          ends_on: string
          hours: number | string | null
          synced_at: string
        }
        Insert: never
        Update: never
        Relationships: []
      }
      /** Passes a manager deleted; the sync does not bring them back. */
      jd_dismissed_operations: {
        Row: {
          jd_id: string
          field_id: string | null
          summary: string | null
          reason: string | null
          dismissed_at: string
          dismissed_by: string | null
        }
        Insert: { jd_id: string; field_id?: string | null; summary?: string | null; reason?: string | null; dismissed_by?: string | null }
        Update: { reason?: string | null }
        Relationships: []
      }
      jd_operators: {
        Row: {
          id: string
          jd_id: string
          name: string
          user_id: string | null
          archived: boolean
          synced_at: string
        }
        Insert: { jd_id: string; name: string; user_id?: string | null }
        Update: { name?: string; user_id?: string | null; archived?: boolean }
        Relationships: []
      }
      chemical_labels: {
        Row: {
          registration_number: string
          recrop_status: string | null
          recrop_extracted_at: string | null
          recrop_note: string | null
          grazing_rules_status: string | null
          grazing_rules_extracted_at: string | null
          grazing_rules_note: string | null
          water_volume: string | null
          application_method: 'ground' | 'aerial' | 'both' | null
          rainfast_hours: number | null
          irrigation_hours: number | null
          /** The LONGEST Restricted Entry Interval on the label, whatever
           *  activity it covers. Kept as the conservative figure. */
          reentry_hours: number | null
          /** The interval governing ordinary field work — scouting, irrigation,
           *  equipment. What the warnings actually run on. Not necessarily the
           *  smaller of the two: a label can set longer for scouting. */
          reentry_field_hours: number | null
          reentry_note: string | null
          grazing_restriction: string | null
          notes: string | null
          /** PMRA's document id; changes when they reissue the label. */
          label_doc_id: string | null
          label_text: string | null
          label_pages: number | null
          extracted_at: string | null
          extraction_model: string | null
          extraction_notes: string | null
          /** Set as the read happens, because a background function's reply
           *  reaches nobody — 'queued' then 'reading' then 'ok' or 'error'. */
          extraction_status: 'queued' | 'reading' | 'ok' | 'error' | null
          extraction_error: string | null
          extraction_started_at: string | null
          /** Read again even if the PMRA document is unchanged — for when the
           *  extraction contract changed rather than the label. Cleared by the
           *  worker on a successful read. */
          extraction_force: boolean
          /** Consecutive failed or abandoned reads; the stale sweep counts the
           *  abandoned ones, which no catch block can see. Reset on success. */
          extraction_attempts: number
          /** Column name -> the verbatim label sentence the value came from. */
          evidence: Record<string, string>
          /** Columns a person corrected; re-extraction leaves these alone. */
          manual_fields: string[]
          updated_by: string | null
          updated_at: string
        }
        Insert: {
          registration_number: string
          manual_fields?: string[]
          water_volume?: string | null
          application_method?: 'ground' | 'aerial' | 'both' | null
          rainfast_hours?: number | null
          irrigation_hours?: number | null
          reentry_hours?: number | null
          reentry_field_hours?: number | null
          reentry_note?: string | null
          grazing_restriction?: string | null
          notes?: string | null
          updated_by?: string | null
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['chemical_labels']['Insert']>
        Relationships: []
      }
      chemical_label_crops: {
        Row: {
          id: string
          registration_number: string
          crop: string
          pest: string | null
          rate: string | null
          preharvest_interval_days: number | null
          replant_interval_days: number | null
          rotation_restriction: string | null
          /** Longest re-entry interval this label states for THIS crop. */
          reentry_hours: number | null
          /** Re-entry for field work on THIS crop; what the warning uses when
           *  the crop in the field matches this row. */
          reentry_field_hours: number | null
          notes: string | null
          origin: 'manual' | 'claude'
          evidence: { quote?: string } | null
          updated_by: string | null
          updated_at: string
        }
        Insert: {
          registration_number: string
          crop: string
          origin?: 'manual' | 'claude'
          pest?: string | null
          rate?: string | null
          preharvest_interval_days?: number | null
          reentry_hours?: number | null
          reentry_field_hours?: number | null
          replant_interval_days?: number | null
          rotation_restriction?: string | null
          notes?: string | null
          updated_by?: string | null
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['chemical_label_crops']['Insert']>
        Relationships: []
      }
      cameras: {
        Row: {
          id: string
          name: string
          location: string | null
          field_id: string | null
          /** Environment Canada station number, when the camera watches a gauge. */
          river_station: string | null
          kind: CameraKind
          stream_url: string | null
          refresh_seconds: number
          brand: string | null
          model: string | null
          notes: string | null
          active: boolean
          sort_order: number
          created_at: string
          updated_at: string
        }
        Insert: {
          name: string
          location?: string | null
          field_id?: string | null
          river_station?: string | null
          kind?: CameraKind
          stream_url?: string | null
          refresh_seconds?: number
          brand?: string | null
          model?: string | null
          notes?: string | null
          active?: boolean
          sort_order?: number
        }
        Update: Partial<Database['public']['Tables']['cameras']['Insert']> & {
          updated_at?: string
        }
        Relationships: []
      }
      cost_benchmarks: {
        Row: {
          key: string
          base_year: number
          source: string
          index_as_of: string | null
          lines: Json
          total_per_cow: number | string | null
          refreshed_at: string
        }
        Insert: {
          key: string
          base_year: number
          source: string
          index_as_of?: string | null
          lines: Json
          total_per_cow?: number | null
          refreshed_at?: string
        }
        Update: Partial<Database['public']['Tables']['cost_benchmarks']['Insert']>
        Relationships: []
      }
      market_alerts: {
        Row: {
          id: string
          series_id: string
          created_by: string | null
          direction: 'above' | 'below'
          threshold: number | string
          label: string | null
          active: boolean
          last_fired_at: string | null
          last_fired_value: number | string | null
          armed: boolean
          created_at: string
        }
        Insert: {
          series_id: string
          created_by?: string | null
          direction: 'above' | 'below'
          threshold: number
          label?: string | null
          active?: boolean
          armed?: boolean
        }
        Update: Partial<Database['public']['Tables']['market_alerts']['Insert']> & {
          last_fired_at?: string | null
          last_fired_value?: number | null
        }
        Relationships: []
      }
      market_series: {
        Row: {
          id: string
          code: string
          kind: 'crop' | 'cattle' | 'fx' | 'index' | 'fertilizer' | 'fuel'
          name: string
          commodity: string
          unit: string
          region: string | null
          source: string
          crop_id: string | null
          derived: boolean
          archived: boolean
          notes: string | null
          created_at: string
        }
        Insert: {
          code: string
          kind: 'crop' | 'cattle' | 'fx' | 'index' | 'fertilizer' | 'fuel'
          name: string
          commodity: string
          unit: string
          region?: string | null
          source: string
          crop_id?: string | null
          derived?: boolean
          archived?: boolean
          notes?: string | null
        }
        Update: Partial<Database['public']['Tables']['market_series']['Insert']>
        Relationships: []
      }
      market_prices: {
        Row: {
          id: string
          series_id: string
          observed_on: string
          /** Numerics arrive as strings through PostgREST; coerce before use. */
          value: number | string | null
          low: number | string | null
          high: number | string | null
          source_url: string | null
          /** Auction reports (20261005020000): head sold, lot weights, top sale, class as printed. */
          head: number | null
          avg_weight_lb: number | string | null
          weight_min_lb: number | null
          weight_max_lb: number | null
          top: number | string | null
          class_label: string | null
        }
        Insert: {
          series_id: string
          observed_on: string
          value?: number | null
          low?: number | null
          high?: number | null
          source_url?: string | null
          head?: number | null
          avg_weight_lb?: number | null
          weight_min_lb?: number | null
          weight_max_lb?: number | null
          top?: number | null
          class_label?: string | null
        }
        Update: Partial<Database['public']['Tables']['market_prices']['Insert']>
        Relationships: []
      }
      auction_reports: {
        Row: {
          id: string
          market: 'medicine-hat' | 'lethbridge' | 'calgary' | 'team-online'
          report_key: string
          sale_date: string | null
          url: string | null
          title: string | null
          status: 'stored' | 'failed' | 'skipped'
          attempts: number
          problem: string | null
          total_head: number | null
          comment: string | null
          parsed: Json | null
          model: string | null
          read_at: string
        }
        Insert: {
          market: 'medicine-hat' | 'lethbridge' | 'calgary' | 'team-online'
          report_key: string
          sale_date?: string | null
          url?: string | null
          title?: string | null
          status: 'stored' | 'failed' | 'skipped'
          attempts?: number
          problem?: string | null
          total_head?: number | null
          comment?: string | null
          parsed?: Json | null
          model?: string | null
          read_at?: string
        }
        Update: Partial<Database['public']['Tables']['auction_reports']['Insert']>
        Relationships: []
      }
      market_futures: {
        Row: {
          id: string
          series_id: string
          quote_on: string
          contract_month: string
          value: number | string | null
        }
        Insert: {
          series_id: string
          quote_on: string
          contract_month: string
          value?: number | null
        }
        Update: Partial<Database['public']['Tables']['market_futures']['Insert']>
        Relationships: []
      }
      cattle_sales: {
        Row: {
          id: string
          ranch: string
          crop_year: number
          animal_class: 'heifers' | 'bulls' | 'steers' | 'runts'
          head: number | null
          sale_date: string | null
          delivery_date: string | null
          avg_weight_lb: number | string | null
          total_lb: number | string | null
          price_per_lb: number | string | null
          total_price: number | string | null
          buyer: string | null
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          ranch: string
          crop_year: number
          animal_class: 'heifers' | 'bulls' | 'steers' | 'runts'
          head?: number | null
          sale_date?: string | null
          delivery_date?: string | null
          avg_weight_lb?: number | null
          total_lb?: number | null
          price_per_lb?: number | null
          total_price?: number | null
          buyer?: string | null
          notes?: string | null
        }
        Update: Partial<Database['public']['Tables']['cattle_sales']['Insert']> & {
          updated_at?: string
        }
        Relationships: []
      }
      cattle_cost_assumptions: {
        Row: {
          id: string
          ranch: string
          crop_year: number
          cow_cost_per_head: number | string | null
          feed_cost_per_head: number | string | null
          pasture_cost_per_head: number | string | null
          vet_cost_per_head: number | string | null
          other_cost_per_head: number | string | null
          death_loss_pct: number | string | null
          weaning_rate_pct: number | string | null
          cost_of_gain_per_lb: number | string | null
          /** Typed cull cow price, $/cwt: the fallback when no market sold cows lately. */
          cow_yardage_per_day: number | string | null
          calf_yardage_per_day: number | string | null
          cull_cow_price_cwt: number | string | null
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          ranch: string
          crop_year: number
          cow_cost_per_head?: number | null
          feed_cost_per_head?: number | null
          pasture_cost_per_head?: number | null
          vet_cost_per_head?: number | null
          other_cost_per_head?: number | null
          death_loss_pct?: number | null
          weaning_rate_pct?: number | null
          cost_of_gain_per_lb?: number | null
          cow_yardage_per_day?: number | null
          calf_yardage_per_day?: number | null
          cull_cow_price_cwt?: number | null
          notes?: string | null
          /** Set explicitly on upsert, where the insert default would not fire. */
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['cattle_cost_assumptions']['Insert']> & {
          updated_at?: string
        }
        Relationships: []
      }
      task_assignees: {
        Row: {
          id: string
          task_id: string
          user_id: string
          assigned_at: string
          assigned_by: string | null
        }
        Insert: {
          task_id: string
          user_id: string
          assigned_by?: string | null
        }
        Update: Partial<Database['public']['Tables']['task_assignees']['Insert']>
        Relationships: []
      }
      weed_patches: {
        Row: {
          id: string
          /** Slug from WEEDS in @/lib/weeds. */
          weed: string
          geojson: Json
          acres: number | null
          field_id: string | null
          severity: 'light' | 'moderate' | 'heavy' | null
          notes: string | null
          observed_on: string
          treated_on: string | null
          /** 'sprayed' | 'mowed' | 'other' — how it was dealt with. */
          treatment: string | null
          /** What was sprayed, as named at the time, and the product it was. */
          chemical: string | null
          chemical_id: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          weed: string
          geojson: Json
          acres?: number | null
          field_id?: string | null
          severity?: 'light' | 'moderate' | 'heavy' | null
          notes?: string | null
          observed_on?: string
          treated_on?: string | null
          treatment?: string | null
          chemical?: string | null
          chemical_id?: string | null
          created_by?: string | null
        }
        Update: Partial<Database['public']['Tables']['weed_patches']['Insert']> & {
          updated_at?: string
        }
        Relationships: []
      }
      jd_equipment: {
        Row: {
          id: string
          jd_id: string
          /** Deere's telematics id — not the ISG id. Hours and alerts key off it. */
          platform_machine_id: string | null
          name: string | null
          category: string | null
          make: string | null
          model: string | null
          equipment_type: string | null
          serial_number: string | null
          vin: string | null
          engine_hours: number | null
          /** When that reading was taken — hours with no date cannot be judged. */
          engine_hours_at: string | null
          /** Ours, never Deere's — a sync must not touch these five. */
          warranty_provider: string | null
          warranty_starts_on: string | null
          warranty_expires_on: string | null
          warranty_hours: number | null
          warranty_note: string | null
          archived: boolean
          is_manual: boolean
          notes: string | null
          raw: Json | null
          synced_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          jd_id: string
          platform_machine_id?: string | null
          name?: string | null
          category?: string | null
          make?: string | null
          model?: string | null
          equipment_type?: string | null
          serial_number?: string | null
          vin?: string | null
          engine_hours?: number | null
          engine_hours_at?: string | null
          warranty_provider?: string | null
          warranty_starts_on?: string | null
          warranty_expires_on?: string | null
          warranty_hours?: number | null
          warranty_note?: string | null
          archived?: boolean
          is_manual?: boolean
          notes?: string | null
        }
        Update: Partial<Database['public']['Tables']['jd_equipment']['Insert']> & {
          updated_at?: string
        }
        Relationships: []
      }
      jd_equipment_alerts: {
        Row: {
          id: string
          jd_id: string
          equipment_jd_id: string
          occurred_at: string | null
          severity: string | null
          color: string | null
          /** Deere's own plain-English text for the fault. */
          description: string | null
          code: string | null
          engine_hours: number | null
          acknowledged: boolean
          ignored: boolean
          task_id: string | null
          raw: Json | null
          synced_at: string | null
          created_at: string
        }
        Insert: { jd_id: string; equipment_jd_id: string }
        Update: { task_id?: string | null; acknowledged?: boolean; ignored?: boolean }
        Relationships: []
      }
      equipment_service_plans: {
        Row: {
          id: string
          equipment_id: string
          name: string
          interval_hours: number | null
          interval_months: number | null
          last_done_hours: number | null
          last_done_on: string | null
          warn_within_hours: number
          notes: string | null
          active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          equipment_id: string
          name: string
          interval_hours?: number | null
          interval_months?: number | null
          last_done_hours?: number | null
          last_done_on?: string | null
          warn_within_hours?: number
          notes?: string | null
          active?: boolean
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['equipment_service_plans']['Insert']>
        Relationships: []
      }
      equipment_service_log: {
        Row: {
          id: string
          equipment_id: string
          plan_id: string | null
          done_on: string
          engine_hours: number | null
          notes: string | null
          cost: number | null
          done_by: string | null
          created_at: string
        }
        Insert: {
          equipment_id: string
          plan_id?: string | null
          done_on?: string
          engine_hours?: number | null
          notes?: string | null
          cost?: number | null
          done_by?: string | null
        }
        Update: Partial<Database['public']['Tables']['equipment_service_log']['Insert']>
        Relationships: []
      }
      jd_products: {
        Row: {
          id: string
          name: string
          /** Canonical only — rates are normalised to litres or kilograms first. */
          unit: 'L' | 'kg'
          price_per_unit: number | null
          pmra_registration: string | null
          notes: string | null
          /** Date of the invoice this price came from; null means hand-typed. */
          price_updated_on: string | null
          price_source: string | null
          /** Which pricing list it appears under. */
          label_note: string | null
          manual_last_applied: string | null
          manual_crops: string[]
          category: 'chemical' | 'fertilizer' | 'other'
          created_at: string
          updated_at: string
        }
        Insert: {
          name: string
          unit: 'L' | 'kg'
          price_per_unit?: number | null
          pmra_registration?: string | null
          price_updated_on?: string | null
          price_source?: string | null
          label_note?: string | null
          manual_last_applied?: string | null
          manual_crops?: string[]
          category?: 'chemical' | 'fertilizer' | 'other'
          notes?: string | null
        }
        Update: Partial<Database['public']['Tables']['jd_products']['Insert']> & {
          updated_at?: string
        }
        Relationships: []
      }
      fert_bookings: {
        Row: {
          id: string
          crop_year: number
          product: string
          supplier: string
          tonnes: number
          price_per_tonne: number | null
          booked_on: string
          delivered: boolean
          note: string | null
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          crop_year: number
          product: string
          supplier?: string
          tonnes: number
          price_per_tonne?: number | null
          booked_on?: string
          delivered?: boolean
          note?: string | null
          created_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          crop_year?: number
          product?: string
          supplier?: string
          tonnes?: number
          price_per_tonne?: number | null
          booked_on?: string
          delivered?: boolean
          note?: string | null
          created_by?: string | null
          created_at?: string
        }
        Relationships: []
      }
      fert_quotes: {
        Row: {
          id: string
          crop_year: number
          product: string
          supplier: string
          price_per_tonne: number
          quoted_on: string
          valid_until: string | null
          includes_delivery: boolean
          note: string | null
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          crop_year: number
          product: string
          supplier: string
          price_per_tonne: number
          quoted_on?: string
          valid_until?: string | null
          includes_delivery?: boolean
          note?: string | null
          created_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          crop_year?: number
          product?: string
          supplier?: string
          price_per_tonne?: number
          quoted_on?: string
          valid_until?: string | null
          includes_delivery?: boolean
          note?: string | null
          created_by?: string | null
          created_at?: string
        }
        Relationships: []
      }
      fert_programs: {
        Row: {
          id: string
          supplier: string
          name: string
          discount_pct: number | null
          discount_per_tonne: number | null
          deadline: string
          terms: string | null
          status: 'open' | 'taken' | 'passed'
          reminded_at: string | null
          pay_by: string | null
          would_pay_on: string | null
          note: string | null
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          supplier: string
          name: string
          discount_pct?: number | null
          discount_per_tonne?: number | null
          deadline: string
          terms?: string | null
          status?: 'open' | 'taken' | 'passed'
          reminded_at?: string | null
          pay_by?: string | null
          would_pay_on?: string | null
          note?: string | null
          created_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          supplier?: string
          name?: string
          discount_pct?: number | null
          discount_per_tonne?: number | null
          deadline?: string
          terms?: string | null
          status?: 'open' | 'taken' | 'passed'
          reminded_at?: string | null
          pay_by?: string | null
          would_pay_on?: string | null
          note?: string | null
          created_by?: string | null
          created_at?: string
        }
        Relationships: []
      }
      fert_inventory: {
        Row: {
          id: string
          product: string
          quantity: number
          unit: 't' | 'L' | 'kg'
          bin_id: string | null
          location: string | null
          counted_on: string
          note: string | null
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          product: string
          quantity: number
          unit?: 't' | 'L' | 'kg'
          bin_id?: string | null
          location?: string | null
          counted_on?: string
          note?: string | null
          created_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          product?: string
          quantity?: number
          unit?: 't' | 'L' | 'kg'
          bin_id?: string | null
          location?: string | null
          counted_on?: string
          note?: string | null
          created_by?: string | null
          created_at?: string
        }
        Relationships: []
      }
      fert_split_plans: {
        Row: {
          id: string
          field_id: string
          crop_year: number
          upfront_pct: number
          status: 'planned' | 'applied' | 'skipped'
          decided_on: string | null
          note: string | null
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          field_id: string
          crop_year: number
          upfront_pct?: number
          status?: 'planned' | 'applied' | 'skipped'
          decided_on?: string | null
          note?: string | null
          created_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          field_id?: string
          crop_year?: number
          upfront_pct?: number
          status?: 'planned' | 'applied' | 'skipped'
          decided_on?: string | null
          note?: string | null
          created_by?: string | null
          created_at?: string
        }
        Relationships: []
      }
      fert_check_strips: {
        Row: {
          id: string
          field_id: string
          crop_year: number
          nutrient: 'N' | 'P2O5' | 'K2O' | 'S' | 'other'
          field_rate: number | null
          strip_rate: number | null
          strip_acres: number | null
          where_text: string | null
          field_yield: number | null
          strip_yield: number | null
          yield_unit: string | null
          note: string | null
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          field_id: string
          crop_year: number
          nutrient?: 'N' | 'P2O5' | 'K2O' | 'S' | 'other'
          field_rate?: number | null
          strip_rate?: number | null
          strip_acres?: number | null
          where_text?: string | null
          field_yield?: number | null
          strip_yield?: number | null
          yield_unit?: string | null
          note?: string | null
          created_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          field_id?: string
          crop_year?: number
          nutrient?: 'N' | 'P2O5' | 'K2O' | 'S' | 'other'
          field_rate?: number | null
          strip_rate?: number | null
          strip_acres?: number | null
          where_text?: string | null
          field_yield?: number | null
          strip_yield?: number | null
          yield_unit?: string | null
          note?: string | null
          created_by?: string | null
          created_at?: string
        }
        Relationships: []
      }
      fert_settings: {
        Row: {
          id: string
          key: string
          value: Json
          updated_by: string | null
          updated_at: string
        }
        Insert: {
          id?: string
          key: string
          value: Json
          updated_by?: string | null
          updated_at?: string
        }
        Update: {
          id?: string
          key?: string
          value?: Json
          updated_by?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      fert_buy_signals: {
        Row: {
          id: string
          series_id: string
          state: 'cheap' | 'middle' | 'dear'
          percentile: number | null
          changed_on: string
          notified_at: string | null
        }
        Insert: {
          id?: string
          series_id: string
          state: 'cheap' | 'middle' | 'dear'
          percentile?: number | null
          changed_on?: string
          notified_at?: string | null
        }
        Update: {
          id?: string
          series_id?: string
          state?: 'cheap' | 'middle' | 'dear'
          percentile?: number | null
          changed_on?: string
          notified_at?: string | null
        }
        Relationships: []
      }
      pl_op_grids: {
        Row: {
          id: string
          field_id: string
          crop_year: number
          operation_id: string | null
          source: 'deere' | 'farmtrx'
          operation_type: string
          operation_date: string | null
          kind: 'input' | 'yield' | 'coverage'
          product_hash: string
          product_name: string | null
          rate_unit: string | null
          cell_m: number
          /** [[gx, gy, rate, covered], ...] on the farm-wide grid in pl-grid.ts. */
          cells: [number, number, number, number][]
          cell_count: number
          point_count: number
          note: string | null
          built_at: string
        }
        Insert: {
          id?: string
          field_id: string
          crop_year: number
          operation_id?: string | null
          source: 'deere' | 'farmtrx'
          operation_type: string
          operation_date?: string | null
          kind: 'input' | 'yield' | 'coverage'
          product_hash?: string
          product_name?: string | null
          rate_unit?: string | null
          cell_m?: number
          cells: [number, number, number, number][]
          cell_count: number
          point_count: number
          note?: string | null
          built_at?: string
        }
        Update: Partial<Database['public']['Tables']['pl_op_grids']['Insert']>
        Relationships: []
      }
      sat_images: {
        Row: {
          id: string
          subject_type: 'field' | 'pasture'
          subject_id: string
          scene_id: string | null
          sensed_on: string
          kind: string
          storage_path: string
          width: number | null
          height: number | null
          west: number
          south: number
          east: number
          north: number
          stretch_min: number | null
          stretch_max: number | null
          created_at: string
        }
        // Written only by the imagery sync, as the service role.
        Insert: never
        Update: never
        Relationships: []
      }
      pl_field_lines: {
        Row: {
          id: string
          field_id: string
          crop_year: number
          side: 'input' | 'output'
          line_key: string
          label: string
          unit: string | null
          price_per_unit: number | null
          amount: number | null
          is_manual: boolean
          removed: boolean
          updated_by: string | null
          updated_at: string
        }
        Insert: {
          id?: string
          field_id: string
          crop_year: number
          side: 'input' | 'output'
          line_key: string
          label: string
          unit?: string | null
          price_per_unit?: number | null
          amount?: number | null
          is_manual?: boolean
          removed?: boolean
          updated_by?: string | null
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['pl_field_lines']['Insert']>
        Relationships: []
      }
      delivery_sites: {
        /** lat/lng: where the elevator is, for road routing; location_note says when it is only approximate. */
        Row: { id: string; name: string; kind: string; active: boolean; created_by: string | null; created_at: string; lat: number | null; lng: number | null; location_note: string | null }
        Insert: { id?: string; name: string; kind?: string; active?: boolean; created_by?: string | null; created_at?: string; lat?: number | null; lng?: number | null; location_note?: string | null }
        Update: { id?: string; name?: string; kind?: string; active?: boolean; created_by?: string | null; created_at?: string; lat?: number | null; lng?: number | null; location_note?: string | null }
        Relationships: []
      }
      bin_loads: {
        Row: {
          id: string
          /** Grain protein off the elevator ticket, %. */
          protein_pct: number | null
          /** Shrinks the field yield to the dry standard. */
          moisture_pct: number | null
          bin_id: string | null
          crop_id: string
          variety: string | null
          crop_year: number
          field_id: string | null
          loaded_on: string
          gross_kg: number | null
          tare_kg: number | null
          net_kg: number | null
          lb_per_bu: number
          bushels: number | null
          truck: string | null
          trailer: string | null
          last_from_field: boolean
          delivery_site_id: string | null
          contract_id: string | null
          /** How the weight was given: full & empty, net off the truck, or a bin total. */
          entry_kind: 'weighed' | 'net' | 'bin_total'
          load_count: number | null
          driver_id: string | null
          driver: string | null
          note: string | null
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          /** Grain protein off the elevator ticket, %. */
          protein_pct?: number | null
          /** Shrinks the field yield to the dry standard. */
          moisture_pct?: number | null
          bin_id?: string | null
          crop_id: string
          variety?: string | null
          crop_year: number
          field_id?: string | null
          loaded_on: string
          gross_kg?: number | null
          tare_kg?: number | null
          lb_per_bu: number
          truck?: string | null
          trailer?: string | null
          last_from_field?: boolean
          delivery_site_id?: string | null
          contract_id?: string | null
          entry_kind?: 'weighed' | 'net' | 'bin_total'
          load_count?: number | null
          driver_id?: string | null
          driver?: string | null
          note?: string | null
          created_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          /** Grain protein off the elevator ticket, %. */
          protein_pct?: number | null
          /** Shrinks the field yield to the dry standard. */
          moisture_pct?: number | null
          bin_id?: string | null
          crop_id?: string
          variety?: string | null
          crop_year?: number
          field_id?: string | null
          loaded_on?: string
          gross_kg?: number | null
          tare_kg?: number | null
          lb_per_bu?: number
          truck?: string | null
          trailer?: string | null
          last_from_field?: boolean
          delivery_site_id?: string | null
          contract_id?: string | null
          entry_kind?: 'weighed' | 'net' | 'bin_total'
          load_count?: number | null
          driver_id?: string | null
          driver?: string | null
          note?: string | null
          created_by?: string | null
          created_at?: string
        }
        Relationships: []
      }
      product_documents: {
        Row: {
          id: string
          product_id: string
          title: string
          filename: string
          storage_path: string
          source: string | null
          summary: string | null
          uploaded_by: string | null
          uploaded_at: string
        }
        Insert: {
          id?: string
          product_id: string
          title: string
          filename: string
          storage_path: string
          source?: string | null
          summary?: string | null
          uploaded_by?: string | null
          uploaded_at?: string
        }
        Update: {
          id?: string
          product_id?: string
          title?: string
          filename?: string
          storage_path?: string
          source?: string | null
          summary?: string | null
          uploaded_by?: string | null
          uploaded_at?: string
        }
        Relationships: []
      }
      jd_product_aliases: {
        Row: {
          deere_name: string
          product_id: string | null
          ignored: boolean
          created_at: string
        }
        Insert: { deere_name: string; product_id?: string | null; ignored?: boolean }
        Update: { product_id?: string | null; ignored?: boolean }
        Relationships: []
      }
      chemicals: {
        Row: {
          id: string
          registration_number: string
          name: string
          name_fr: string | null
          registration_status: string | null
          expiry_date: string | null
          marketing_type: string | null
          first_registered: string | null
          active_ingredients: string | null
          product_type: string | null
          registrant: string | null
          use_site_categories: string | null
          sites_of_use: string | null
          pests: string | null
          synced_at: string
        }
        Insert: {
          registration_number: string
          name: string
          name_fr?: string | null
          registration_status?: string | null
          expiry_date?: string | null
          marketing_type?: string | null
          first_registered?: string | null
          active_ingredients?: string | null
          product_type?: string | null
          registrant?: string | null
          use_site_categories?: string | null
          sites_of_use?: string | null
          pests?: string | null
          synced_at?: string
        }
        Update: Partial<Database['public']['Tables']['chemicals']['Insert']>
        Relationships: []
      }
      smrid_areas: {
        Row: {
          id: string
          area_number: number
          region: string | null
          coordinator_name: string | null
          coordinator_phone: string | null
          phone_note: string | null
          checked_at: string | null
          source_url: string
          updated_at: string
        }
        Insert: {
          area_number: number
          region?: string | null
          coordinator_name?: string | null
          coordinator_phone?: string | null
          phone_note?: string | null
          checked_at?: string | null
          source_url?: string
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['smrid_areas']['Insert']>
        Relationships: []
      }
      water_licences: {
        Row: {
          id: string
          farm_id: string | null
          licence_number: string | null
          volume: number | null
          rate_of_diversion: number | null
          priority_number: string | null
          notes: string | null
          source: 'oldman_river' | 'south_saskatchewan_river' | 'other' | null
          holder: string | null
          status: 'issued' | 'draft' | 'pending' | null
          priority_date: string | null
          alt_numbers: string | null
          points_of_diversion: string | null
          lands: string | null
          expiry: string | null
          conditions: string | null
          volume_m3: number | null
        }
        Insert: {
          id?: string
          farm_id?: string | null
          licence_number?: string | null
          volume?: number | null
          rate_of_diversion?: number | null
          priority_number?: string | null
          notes?: string | null
          source?: 'oldman_river' | 'south_saskatchewan_river' | 'other' | null
          holder?: string | null
          status?: 'issued' | 'draft' | 'pending' | null
          priority_date?: string | null
          alt_numbers?: string | null
          points_of_diversion?: string | null
          lands?: string | null
          expiry?: string | null
          conditions?: string | null
          volume_m3?: number | null
        }
        Update: Partial<Database['public']['Tables']['water_licences']['Insert']>
        Relationships: []
      }
      field_pivots: {
        Row: {
          id: string
          field_id: string
          pump_id: string | null
          water_licence_id: string | null
          water_source: 'oldman_river' | 'south_saskatchewan_river' | 'smrid' | 'other' | null
          licence_note: string | null
          acres_irrigated: number | null
          length_m: number | null
          towers: number | null
          span_length: string | null
          brand: string | null
          pipe_dimension: string | null
          sprinkler_package: string | null
          tire_type: string | null
          gpm: number | null
          meter_name: string | null
          smrid_area: number | null
          contact: string | null
          phone: string | null
          pivot_year: number | null
          system_type: string | null
          system_capacity_ls: number | null
          time_to_full_circle_h: number | null
          end_gun_degrees: number | null
          application_efficiency: number | null
          acre_feet_allotment: number | null
          alloted_inches: number | null
          end_gun: boolean | null
          end_treatment: string | null
          drop_height_ft: number | null
          pressure_regulators: boolean | null
          regulator_psi: number | null
          nozzles_replaced_year: number | null
          vri: boolean | null
          pivot_pressure_psi: number | null
          efficiency_basis: 'default' | 'suggested' | 'measured' | null
          gpm_source: string | null
          on_river: boolean
          updated_at: string
          /** From the pivot nameplate. */
          model: string | null
          serial_number: string | null
          voltage: number | null
          pivot_type: string | null
          running_amps: number | null
          max_fuse_amps: number | null
          plate_amps: number | null
          phase: number | null
          hz: number | null
          nameplate_note: string | null
          equipment_flags: string | null
          /** The pivot is never run: the field counts as dryland everywhere. */
          not_used: boolean
          not_used_note: string | null
          /** Somebody else (the landowner) runs this pivot and its pump for us. */
          operated_by: string | null
        }
        Insert: {
          id?: string
          field_id: string
          on_river?: boolean
          pump_id?: string | null
          water_licence_id?: string | null
          water_source?: 'oldman_river' | 'south_saskatchewan_river' | 'smrid' | 'other' | null
          licence_note?: string | null
          acres_irrigated?: number | null
          length_m?: number | null
          towers?: number | null
          span_length?: string | null
          brand?: string | null
          pipe_dimension?: string | null
          sprinkler_package?: string | null
          tire_type?: string | null
          gpm?: number | null
          meter_name?: string | null
          contact?: string | null
          phone?: string | null
          pivot_year?: number | null
          system_type?: string | null
          system_capacity_ls?: number | null
          time_to_full_circle_h?: number | null
          end_gun_degrees?: number | null
          application_efficiency?: number | null
          acre_feet_allotment?: number | null
          alloted_inches?: number | null
          end_gun?: boolean | null
          end_treatment?: string | null
          drop_height_ft?: number | null
          pressure_regulators?: boolean | null
          regulator_psi?: number | null
          nozzles_replaced_year?: number | null
          vri?: boolean | null
          pivot_pressure_psi?: number | null
          efficiency_basis?: 'default' | 'suggested' | 'measured' | null
          gpm_source?: string | null
          model?: string | null
          serial_number?: string | null
          voltage?: number | null
          pivot_type?: string | null
          running_amps?: number | null
          max_fuse_amps?: number | null
          plate_amps?: number | null
          phase?: number | null
          hz?: number | null
          nameplate_note?: string | null
          equipment_flags?: string | null
          not_used?: boolean
          not_used_note?: string | null
          operated_by?: string | null
        }
        Update: Partial<Database['public']['Tables']['field_pivots']['Insert']>
        Relationships: []
      }
      field_soil_profiles: {
        Row: {
          source: 'default' | 'aimm' | 'survey' | 'manual' | 'samples' | 'decisive' | 'ici'
          sample_note: string | null
          survey_awc_mm_m: number | null
          survey_note: string | null
          id: string
          field_id: string
          sample_site_name: string | null
          max_root_zone_depth_m: number
          allowable_depletion_pct: number
          layers: Json
          comments: string | null
          updated_at: string
        }
        Insert: {
          source?: 'default' | 'aimm' | 'survey' | 'manual' | 'samples' | 'decisive' | 'ici'
          sample_note?: string | null
          survey_awc_mm_m?: number | null
          survey_note?: string | null
          id?: string
          field_id: string
          sample_site_name?: string | null
          max_root_zone_depth_m?: number
          allowable_depletion_pct?: number
          layers?: Json
          comments?: string | null
        }
        Update: Partial<Database['public']['Tables']['field_soil_profiles']['Insert']>
        Relationships: []
      }
      soil_moisture_measurements: {
        Row: {
          id: string
          field_id: string
          sample_date: string
          measured_50_mm: number | null
          measured_100_mm: number | null
          modelled_50_mm: number | null
          modelled_100_mm: number | null
          created_at: string
        }
        Insert: {
          id?: string
          field_id: string
          sample_date: string
          measured_50_mm?: number | null
          measured_100_mm?: number | null
          modelled_50_mm?: number | null
          modelled_100_mm?: number | null
        }
        Update: Partial<Database['public']['Tables']['soil_moisture_measurements']['Insert']>
        Relationships: []
      }
      grain_movements: {
        Row: {
          id: string
          crop_year: number
          bin_id: string
          crop_id: string | null
          field_id: string | null
          contract_id: string | null
          movement_type: GrainMovementType
          bushels: number
          moved_at: string
          ticket_number: string | null
          notes: string | null
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          crop_year?: number
          bin_id: string
          crop_id?: string | null
          field_id?: string | null
          contract_id?: string | null
          movement_type: GrainMovementType
          bushels: number
          moved_at?: string
          ticket_number?: string | null
          notes?: string | null
          created_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          crop_year?: number
          bin_id?: string
          crop_id?: string | null
          field_id?: string | null
          contract_id?: string | null
          movement_type?: GrainMovementType
          bushels?: number
          moved_at?: string
          ticket_number?: string | null
          notes?: string | null
          created_by?: string | null
          created_at?: string
        }
        Relationships: []
      }
      input_items: {
        Row: {
          id: string
          name: string
          category: InputCategory
          unit: string
          unit_cost: number | null
          supplier_contact_id: string | null
          notes: string | null
          active: boolean
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          category?: InputCategory
          unit?: string
          unit_cost?: number | null
          supplier_contact_id?: string | null
          notes?: string | null
          active?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          category?: InputCategory
          unit?: string
          unit_cost?: number | null
          supplier_contact_id?: string | null
          notes?: string | null
          active?: boolean
          created_at?: string
        }
        Relationships: []
      }
      input_movements: {
        Row: {
          id: string
          input_item_id: string
          movement_type: InputMovementType
          quantity: number
          unit_cost: number | null
          moved_at: string
          crop_id: string | null
          field_id: string | null
          crop_year: number | null
          po_number: string | null
          notes: string | null
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          input_item_id: string
          movement_type: InputMovementType
          quantity: number
          unit_cost?: number | null
          moved_at?: string
          crop_id?: string | null
          field_id?: string | null
          crop_year?: number | null
          po_number?: string | null
          notes?: string | null
          created_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          input_item_id?: string
          movement_type?: InputMovementType
          quantity?: number
          unit_cost?: number | null
          moved_at?: string
          crop_id?: string | null
          field_id?: string | null
          crop_year?: number | null
          po_number?: string | null
          notes?: string | null
          created_by?: string | null
          created_at?: string
        }
        Relationships: []
      }
      combine_settings: {
        Row: {
          id: string
          machine: string
          crop_key: 'canola' | 'corn' | 'wheat' | 'sainfoin' | 'beans' | 'durum' | 'barley' | 'oats'
          crop_year: number
          rotor_rpm: number | null
          concave_mm: number | null
          vane_angle: number | null
          fan_rpm: number | null
          presieve_mm: number | null
          chaffer_mm: number | null
          sieve_mm: number | null
          ground_speed_mph: number | null
          notes: string | null
          updated_by: string | null
          updated_at: string
        }
        Insert: {
          id?: string
          machine?: string
          crop_key: 'canola' | 'corn' | 'wheat' | 'sainfoin' | 'beans' | 'durum' | 'barley' | 'oats'
          crop_year: number
          rotor_rpm?: number | null
          concave_mm?: number | null
          vane_angle?: number | null
          fan_rpm?: number | null
          presieve_mm?: number | null
          chaffer_mm?: number | null
          sieve_mm?: number | null
          ground_speed_mph?: number | null
          notes?: string | null
          updated_by?: string | null
          updated_at?: string
        }
        Update: {
          id?: string
          machine?: string
          crop_key?: 'canola' | 'corn' | 'wheat' | 'sainfoin' | 'beans' | 'durum' | 'barley' | 'oats'
          crop_year?: number
          rotor_rpm?: number | null
          concave_mm?: number | null
          vane_angle?: number | null
          fan_rpm?: number | null
          presieve_mm?: number | null
          chaffer_mm?: number | null
          sieve_mm?: number | null
          ground_speed_mph?: number | null
          notes?: string | null
          updated_by?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      combine_loss_checks: {
        Row: {
          id: string
          checked_at: string
          machine: string
          crop_key: 'canola' | 'corn' | 'wheat' | 'sainfoin' | 'beans' | 'durum' | 'barley' | 'oats'
          crop_year: number
          field_id: string | null
          seeds: number
          pan_area_sqft: number
          header_ft: number
          discharge_ft: number
          grams_per_1000: number | null
          lb_per_bushel: number | null
          yield_bu_per_acre: number | null
          loss_bu_per_acre: number
          loss_pct: number | null
          source: 'rotor' | 'shoe' | 'header' | 'unknown' | null
          notes: string | null
          created_by: string | null
        }
        Insert: {
          id?: string
          checked_at?: string
          machine?: string
          crop_key: 'canola' | 'corn' | 'wheat' | 'sainfoin' | 'beans' | 'durum' | 'barley' | 'oats'
          crop_year: number
          field_id?: string | null
          seeds: number
          pan_area_sqft: number
          header_ft: number
          discharge_ft: number
          grams_per_1000?: number | null
          lb_per_bushel?: number | null
          yield_bu_per_acre?: number | null
          loss_bu_per_acre: number
          loss_pct?: number | null
          source?: 'rotor' | 'shoe' | 'header' | 'unknown' | null
          notes?: string | null
          created_by?: string | null
        }
        Update: {
          id?: string
          notes?: string | null
          source?: 'rotor' | 'shoe' | 'header' | 'unknown' | null
        }
        Relationships: []
      }
      soil_sample_sites: {
        Row: {
          id: string
          field_id: string
          code: string
          lat: number
          lng: number
          /** Null for a benchmark site that belongs to every year. */
          crop_year: number | null
          depth_label: string | null
          notes: string | null
          active: boolean
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          field_id: string
          code: string
          lat: number
          lng: number
          crop_year?: number | null
          depth_label?: string | null
          notes?: string | null
          active?: boolean
          created_by?: string | null
        }
        Update: {
          field_id?: string
          code?: string
          lat?: number
          lng?: number
          crop_year?: number | null
          depth_label?: string | null
          notes?: string | null
          active?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      tissue_tests: {
        Row: {
          id: string
          /** Potato 4th-petiole nitrate-N, ppm. */
          no3n_ppm: number | null
          field_id: string | null
          crop_year: number
          sampled_on: string | null
          crop: string | null
          /** Sufficiency bands move a long way between stages; without this a
           *  reading can only be read loosely. */
          growth_stage: string | null
          plant_part: string | null
          lab: string | null
          report_ref: string | null
          sample_code: string | null
          n_pct: number | null
          p_pct: number | null
          k_pct: number | null
          ca_pct: number | null
          mg_pct: number | null
          s_pct: number | null
          b_ppm: number | null
          cu_ppm: number | null
          fe_ppm: number | null
          mn_ppm: number | null
          zn_ppm: number | null
          notes: string | null
          source_file: string | null
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          /** Potato 4th-petiole nitrate-N, ppm. */
          no3n_ppm?: number | null
          field_id?: string | null
          crop_year: number
          sampled_on?: string | null
          crop?: string | null
          /** Sufficiency bands move a long way between stages; without this a
           *  reading can only be read loosely. */
          growth_stage?: string | null
          plant_part?: string | null
          lab?: string | null
          report_ref?: string | null
          sample_code?: string | null
          n_pct?: number | null
          p_pct?: number | null
          k_pct?: number | null
          ca_pct?: number | null
          mg_pct?: number | null
          s_pct?: number | null
          b_ppm?: number | null
          cu_ppm?: number | null
          fe_ppm?: number | null
          mn_ppm?: number | null
          zn_ppm?: number | null
          notes?: string | null
          source_file?: string | null
          created_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          /** Potato 4th-petiole nitrate-N, ppm. */
          no3n_ppm?: number | null
          field_id?: string | null
          crop_year?: number
          sampled_on?: string | null
          crop?: string | null
          /** Sufficiency bands move a long way between stages; without this a
           *  reading can only be read loosely. */
          growth_stage?: string | null
          plant_part?: string | null
          lab?: string | null
          report_ref?: string | null
          sample_code?: string | null
          n_pct?: number | null
          p_pct?: number | null
          k_pct?: number | null
          ca_pct?: number | null
          mg_pct?: number | null
          s_pct?: number | null
          b_ppm?: number | null
          cu_ppm?: number | null
          fe_ppm?: number | null
          mn_ppm?: number | null
          zn_ppm?: number | null
          notes?: string | null
          source_file?: string | null
          created_by?: string | null
          created_at?: string
        }
        Relationships: []
      }
      crop_planter_profiles: {
        Row: {
          id: string
          crop_id: string
          depth_setting: string | null
          depth_in_min: number | null
          depth_in_max: number | null
          singulator: string | null
          seed_spacing_in: number | null
          seeds_per_acre_min: number | null
          seeds_per_acre_max: number | null
          planting_speed_mph: number | null
          plate_holes: number | null
          disc_number: string | null
          row_spacing_in: number | null
          passes: number | null
          seeds_per_m2: number | null
          notes: string | null
          updated_by: string | null
          updated_at: string
        }
        Insert: {
          id?: string
          crop_id: string
          depth_setting?: string | null
          depth_in_min?: number | null
          depth_in_max?: number | null
          singulator?: string | null
          seed_spacing_in?: number | null
          seeds_per_acre_min?: number | null
          seeds_per_acre_max?: number | null
          planting_speed_mph?: number | null
          plate_holes?: number | null
          disc_number?: string | null
          row_spacing_in?: number | null
          passes?: number | null
          seeds_per_m2?: number | null
          notes?: string | null
          updated_by?: string | null
          updated_at?: string
        }
        Update: {
          id?: string
          crop_id?: string
          depth_setting?: string | null
          depth_in_min?: number | null
          depth_in_max?: number | null
          singulator?: string | null
          seed_spacing_in?: number | null
          seeds_per_acre_min?: number | null
          seeds_per_acre_max?: number | null
          planting_speed_mph?: number | null
          plate_holes?: number | null
          disc_number?: string | null
          row_spacing_in?: number | null
          passes?: number | null
          seeds_per_m2?: number | null
          notes?: string | null
          updated_by?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      cattle_manifests: {
        Row: {
          id: string
          crop_year: number
          manifest_no: string | null
          moved_on: string
          ranch_id: string | null
          owner_name: string | null
          owner_phone: string | null
          origin_address: string | null
          origin_premises_id: string | null
          brand: string | null
          brand_location: string | null
          destination_contact_id: string | null
          destination_name: string | null
          destination_address: string | null
          destination_phone: string | null
          destination_premises_id: string | null
          purpose: string | null
          transporter_name: string | null
          transporter_phone: string | null
          licence_plate: string | null
          driver_name: string | null
          signed_by: string | null
          signed_on: string | null
          notes: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          crop_year: number
          manifest_no?: string | null
          moved_on?: string
          ranch_id?: string | null
          owner_name?: string | null
          owner_phone?: string | null
          origin_address?: string | null
          origin_premises_id?: string | null
          brand?: string | null
          brand_location?: string | null
          destination_contact_id?: string | null
          destination_name?: string | null
          destination_address?: string | null
          destination_phone?: string | null
          destination_premises_id?: string | null
          purpose?: string | null
          transporter_name?: string | null
          transporter_phone?: string | null
          licence_plate?: string | null
          driver_name?: string | null
          signed_by?: string | null
          signed_on?: string | null
          notes?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          crop_year?: number
          manifest_no?: string | null
          moved_on?: string
          ranch_id?: string | null
          owner_name?: string | null
          owner_phone?: string | null
          origin_address?: string | null
          origin_premises_id?: string | null
          brand?: string | null
          brand_location?: string | null
          destination_contact_id?: string | null
          destination_name?: string | null
          destination_address?: string | null
          destination_phone?: string | null
          destination_premises_id?: string | null
          purpose?: string | null
          transporter_name?: string | null
          transporter_phone?: string | null
          licence_plate?: string | null
          driver_name?: string | null
          signed_by?: string | null
          signed_on?: string | null
          notes?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      cattle_manifest_lines: {
        Row: {
          id: string
          manifest_id: string
          sort_order: number
          animal_class: string | null
          head: number | null
          sex: string | null
          colour: string | null
          avg_weight_lb: number | null
          brand: string | null
          tag_range: string | null
          notes: string | null
        }
        Insert: {
          id?: string
          manifest_id: string
          sort_order?: number
          animal_class?: string | null
          head?: number | null
          sex?: string | null
          colour?: string | null
          avg_weight_lb?: number | null
          brand?: string | null
          tag_range?: string | null
          notes?: string | null
        }
        Update: {
          id?: string
          manifest_id?: string
          sort_order?: number
          animal_class?: string | null
          head?: number | null
          sex?: string | null
          colour?: string | null
          avg_weight_lb?: number | null
          brand?: string | null
          tag_range?: string | null
          notes?: string | null
        }
        Relationships: []
      }
      bins: {
        Row: {
          id: string
          name: string
          capacity_bu: number
          geom: unknown | null
          site: string | null
          notes_md: string | null
          active: boolean
          usual_contents: 'grain' | 'fertilizer'
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          capacity_bu?: number
          geom?: unknown | null
          site?: string | null
          notes_md?: string | null
          active?: boolean
          usual_contents?: 'grain' | 'fertilizer'
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          capacity_bu?: number
          geom?: unknown | null
          site?: string | null
          notes_md?: string | null
          active?: boolean
          usual_contents?: 'grain' | 'fertilizer'
          created_at?: string
        }
        Relationships: []
      }
      bin_allocations: {
        Row: {
          id: string
          crop_year: number
          bin_id: string
          crop_id: string | null
          field_id: string | null
          estimated_bu: number | null
          actual_bu: number | null
          sealed_for_seed: boolean
        }
        Insert: {
          id?: string
          crop_year: number
          bin_id: string
          crop_id?: string | null
          field_id?: string | null
          estimated_bu?: number | null
          actual_bu?: number | null
          sealed_for_seed?: boolean
        }
        Update: {
          id?: string
          crop_year?: number
          bin_id?: string
          crop_id?: string | null
          field_id?: string | null
          estimated_bu?: number | null
          actual_bu?: number | null
          sealed_for_seed?: boolean
        }
        Relationships: []
      }
      contacts: {
        Row: {
          id: string
          company: string | null
          contact_name: string | null
          email: string | null
          phone: string | null
          type: ContactType
          address: string | null
          notes_md: string | null
          tags: string[]
          active: boolean
          created_at: string
        }
        Insert: {
          id?: string
          company?: string | null
          contact_name?: string | null
          email?: string | null
          phone?: string | null
          type?: ContactType
          address?: string | null
          notes_md?: string | null
          tags?: string[]
          active?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          company?: string | null
          contact_name?: string | null
          email?: string | null
          phone?: string | null
          type?: ContactType
          address?: string | null
          notes_md?: string | null
          tags?: string[]
          active?: boolean
          created_at?: string
        }
        Relationships: []
      }
      contracts: {
        Row: {
          id: string
          crop_year: number
          crop_id: string | null
          buyer_contact_id: string | null
          contract_number: string | null
          bushels: number | null
          price_per_unit: number | null
          delivery_start: string | null
          delivery_end: string | null
          delivered_bu: number
          status: ContractStatus
          doc_path: string | null
          notes_md: string | null
          created_at: string
        }
        Insert: {
          id?: string
          crop_year: number
          crop_id?: string | null
          buyer_contact_id?: string | null
          contract_number?: string | null
          bushels?: number | null
          price_per_unit?: number | null
          delivery_start?: string | null
          delivery_end?: string | null
          delivered_bu?: number
          status?: ContractStatus
          doc_path?: string | null
          notes_md?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          crop_year?: number
          crop_id?: string | null
          buyer_contact_id?: string | null
          contract_number?: string | null
          bushels?: number | null
          price_per_unit?: number | null
          delivery_start?: string | null
          delivery_end?: string | null
          delivered_bu?: number
          status?: ContractStatus
          doc_path?: string | null
          notes_md?: string | null
          created_at?: string
        }
        Relationships: []
      }
      calendar_events: {
        Row: {
          id: string
          title: string
          kind: EventKind
          field_id: string | null
          user_ids: string[]
          starts_at: string
          ends_at: string | null
          all_day: boolean
          rrule: string | null
          notes_md: string | null
          source: string
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          title: string
          kind?: EventKind
          field_id?: string | null
          user_ids?: string[]
          starts_at: string
          ends_at?: string | null
          all_day?: boolean
          rrule?: string | null
          notes_md?: string | null
          source?: string
          created_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          title?: string
          kind?: EventKind
          field_id?: string | null
          user_ids?: string[]
          starts_at?: string
          ends_at?: string | null
          all_day?: boolean
          rrule?: string | null
          notes_md?: string | null
          source?: string
          created_by?: string | null
          created_at?: string
        }
        Relationships: []
      }
      monthly_task_templates: {
        Row: {
          id: string
          title: string
          start_month: number
          end_month: number
          recurrence: RecurrenceType
          checklist_template_id: string | null
          default_assignee: string | null
          notes_md: string | null
          sort_order: number
          active: boolean
          created_at: string
        }
        Insert: {
          id?: string
          title: string
          start_month: number
          end_month: number
          recurrence?: RecurrenceType
          checklist_template_id?: string | null
          default_assignee?: string | null
          notes_md?: string | null
          sort_order?: number
          active?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          title?: string
          start_month?: number
          end_month?: number
          recurrence?: RecurrenceType
          checklist_template_id?: string | null
          default_assignee?: string | null
          notes_md?: string | null
          sort_order?: number
          active?: boolean
          created_at?: string
        }
        Relationships: []
      }
      monthly_task_instances: {
        Row: {
          id: string
          template_id: string
          crop_year: number
          completed: boolean
          completed_by: string | null
          completed_at: string | null
          task_id: string | null
        }
        Insert: {
          id?: string
          template_id: string
          crop_year: number
          completed?: boolean
          completed_by?: string | null
          completed_at?: string | null
          task_id?: string | null
        }
        Update: {
          id?: string
          template_id?: string
          crop_year?: number
          completed?: boolean
          completed_by?: string | null
          completed_at?: string | null
          task_id?: string | null
        }
        Relationships: []
      }
      equipment: {
        Row: {
          id: string
          name: string
          type: string | null
          make: string | null
          model: string | null
          year: number | null
          serial: string | null
          notes_md: string | null
          active: boolean
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          type?: string | null
          make?: string | null
          model?: string | null
          year?: number | null
          serial?: string | null
          notes_md?: string | null
          active?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          type?: string | null
          make?: string | null
          model?: string | null
          year?: number | null
          serial?: string | null
          notes_md?: string | null
          active?: boolean
          created_at?: string
        }
        Relationships: []
      }
      checklist_templates: {
        Row: {
          map_based: boolean
          yearly: boolean
          /** Yearly only: who each year's copy is assigned to (each gets a task). */
          default_assignees: string[]
          /** Yearly only: month (1–12) the year's copy is made; null = January. */
          start_month: number | null
          /** Due before the first hard freeze: the freeze watch sets the due date and alerts. */
          due_on_freeze: boolean
          id: string
          name: string
          category: ChecklistCategory
          equipment_id: string | null
          description_md: string | null
          active: boolean
          created_at: string
        }
        Insert: {
          due_on_freeze?: boolean
          default_assignees?: string[]
          start_month?: number | null
          map_based?: boolean
          yearly?: boolean
          id?: string
          name: string
          category?: ChecklistCategory
          equipment_id?: string | null
          description_md?: string | null
          active?: boolean
          created_at?: string
        }
        Update: {
          due_on_freeze?: boolean
          default_assignees?: string[]
          start_month?: number | null
          map_based?: boolean
          yearly?: boolean
          id?: string
          name?: string
          category?: ChecklistCategory
          equipment_id?: string | null
          description_md?: string | null
          active?: boolean
          created_at?: string
        }
        Relationships: []
      }
      checklist_template_items: {
        Row: {
          location_id: string | null
          id: string
          template_id: string
          sort_order: number
          text: string
          help_md: string | null
          requires_note: boolean
        }
        Insert: {
          location_id?: string | null
          id?: string
          template_id: string
          sort_order?: number
          text: string
          help_md?: string | null
          requires_note?: boolean
        }
        Update: {
          location_id?: string | null
          id?: string
          template_id?: string
          sort_order?: number
          text?: string
          help_md?: string | null
          requires_note?: boolean
        }
        Relationships: []
      }
      checklist_runs: {
        Row: {
          id: string
          template_id: string
          crop_year: number
          name: string
          assigned_to: string[]
          due_at: string | null
          status: RunStatus
          created_by: string | null
          created_at: string
          completed_at: string | null
        }
        Insert: {
          id?: string
          template_id: string
          crop_year?: number
          name: string
          assigned_to?: string[]
          due_at?: string | null
          status?: RunStatus
          created_by?: string | null
          created_at?: string
          completed_at?: string | null
        }
        Update: {
          id?: string
          template_id?: string
          crop_year?: number
          name?: string
          assigned_to?: string[]
          due_at?: string | null
          status?: RunStatus
          created_by?: string | null
          created_at?: string
          completed_at?: string | null
        }
        Relationships: []
      }
      checklist_run_items: {
        Row: {
          run_location_id: string | null
          id: string
          run_id: string
          sort_order: number
          item_text_snapshot: string
          requires_note: boolean
          checked: boolean
          checked_by: string | null
          checked_at: string | null
          note: string | null
        }
        Insert: {
          run_location_id?: string | null
          id?: string
          run_id: string
          sort_order?: number
          item_text_snapshot: string
          requires_note?: boolean
          checked?: boolean
          checked_by?: string | null
          checked_at?: string | null
          note?: string | null
        }
        Update: {
          run_location_id?: string | null
          id?: string
          run_id?: string
          sort_order?: number
          item_text_snapshot?: string
          requires_note?: boolean
          checked?: boolean
          checked_by?: string | null
          checked_at?: string | null
          note?: string | null
        }
        Relationships: []
      }
      year_unlocks: {
        Row: {
          id: string
          crop_year: number
          unlocked_by: string | null
          unlocked_at: string
        }
        Insert: {
          id?: string
          crop_year: number
          unlocked_by?: string | null
          unlocked_at?: string
        }
        Update: {
          id?: string
          crop_year?: number
          unlocked_by?: string | null
          unlocked_at?: string
        }
        Relationships: []
      }
      plc_devices: {
        Row: {
          id: string
          key: string
          label: string
          host: string | null
          port: number
          unit_id: number
          notes: string | null
          enabled: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          key: string
          label: string
          host?: string | null
          port?: number
          unit_id?: number
          notes?: string | null
          enabled?: boolean
        }
        Update: {
          label?: string
          host?: string | null
          port?: number
          unit_id?: number
          notes?: string | null
          enabled?: boolean
        }
        Relationships: []
      }
      plc_commands: {
        Row: {
          id: string
          device_id: string
          tag: string
          value_num: number | string | null
          value_bool: boolean | null
          value_text: string | null
          status: 'pending' | 'claimed' | 'done' | 'failed' | 'cancelled' | 'expired'
          reason: string | null
          requested_by: string | null
          requested_at: string
          claimed_at: string | null
          completed_at: string | null
          expires_at: string
          attempts: number
          error: string | null
          readback_num: number | string | null
          readback_bool: boolean | null
          readback_text: string | null
        }
        Insert: {
          id?: string
          device_id: string
          tag: string
          value_num?: number | null
          value_bool?: boolean | null
          value_text?: string | null
          reason?: string | null
          requested_by: string
          expires_at?: string
        }
        Update: { status?: 'cancelled' }
        Relationships: []
      }
      plc_reading_history: {
        Row: {
          id: string
          device_id: string
          tag: string
          value_num: number | string | null
          value_bool: boolean | null
          value_text: string | null
          quality: string
          read_at: string
        }
        Insert: { device_id: string; tag: string; read_at: string }
        Update: never
        Relationships: []
      }
      plc_agent_status: {
        Row: {
          id: string
          device_id: string
          connection_state: string
          agent_version: string | null
          agent_host: string | null
          last_seen_at: string | null
          last_poll_at: string | null
          tags_good: number | null
          tags_bad: number | null
          reconnects: number | null
          failures: number | null
          last_error: string | null
          updated_at: string
        }
        Insert: { device_id: string }
        Update: { connection_state?: string }
        Relationships: []
      }
      /** Who wants to hear about a leaking line, and how fast counts as leaking. */
      plc_line_watch: {
        Row: {
          id: string
          plc_pump: number
          muted: boolean
          muted_reason: string | null
          muted_by: string | null
          muted_at: string | null
          decay_psi_per_hour: number | string
          created_at: string
          updated_at: string
        }
        Insert: { plc_pump: number; muted?: boolean; muted_reason?: string | null }
        Update: {
          muted?: boolean
          muted_reason?: string | null
          muted_by?: string | null
          muted_at?: string | null
          decay_psi_per_hour?: number
        }
        Relationships: []
      }
    }
    Views: {
      /** Crop fields inside a pasture's fence, an acre or more of overlap (current boundaries). */
      field_pasture_overlap: {
        Row: { field_id: string; pasture_id: string; pasture_name: string; overlap_acres: number; field_acres: number }
        Relationships: []
      }
      n_rich_strip_list: {
        Row: {
          id: string
          field_id: string
          crop_year: number
          label: string | null
          extra_lb_n: number | null
          notes: string | null
          created_at: string
          geojson: Json
          acres: number | null
        }
        Relationships: []
      }
      /** Each N-rich strip against its field on the same satellite pass. */
      n_strip_sufficiency: {
        Row: {
          strip_id: string
          field_id: string
          crop_year: number
          sensed_on: string
          strip_ndre: number | null
          field_ndre: number | null
          si: number | null
        }
        Relationships: []
      }
      /** AIMM's May–September season per field (whole field, actual days), for calibrating its water need. */
      field_season_water: {
        Row: {
          field_id: string
          year: number
          days: number
          etc_mm: number | null
          potential_etc_mm: number | null
          rain_mm: number | null
          rain_lost_mm: number | null
          effective_irrigation_mm: number | null
          over_irrigation_mm: number | null
          stress_days: number
        }
        Relationships: []
      }
      /** Five seasons of each station's results per parameter, for the concern list. */
      water_quality_summary: {
        Row: {
          station_id: string
          parameter: string
          tested: number
          detected: number
          max_value: number | null
          max_at: string | null
          irr_max_value: number | null
          irr_max_at: string | null
          min_dl: number | null
          max_dl: number | null
          latest_value: number | null
          latest_below: boolean | null
          latest_at: string | null
          first_at: string | null
          max_season_geomean: number | null
          unit: string | null
        }
        Relationships: []
      }
      /** Measured water-sulphur credit per water source (May–Sep median, last five seasons). */
      water_s_credit: {
        Row: {
          water_source: 'oldman' | 'smrid'
          lb_s_per_inch: number | null
          so4_median_mg_l: number | null
          so4_samples: number
          no3n_median_mg_l: number | null
          no3n_all_below_dl: boolean | null
          ec_median_us_cm: number | null
          sar_median: number | null
          latest_sample: string | null
        }
        Relationships: []
      }
      field_yard_distance: {
        Row: { field_id: string; km: number | null }
        Relationships: []
      }
      /** The newest Alberta survey price for each surveyed input. */
      ab_input_latest: {
        Row: {
          item_key: string
          item: string
          category: string
          unit: string | null
          observed_on: string
          price: number
        }
        Relationships: []
      }
      /** Per crop per year: grown, sold, stored, and what is still open. */
      /**
       * Gridded elevation surfaces, one per field per source operation.
       * Relative within a field, NOT tied to sea level -- see
       * docs/TOPOGRAPHY-COVERAGE-AUDIT.md.
       */
      field_topo_surfaces_v: {
        Row: {
          id: string
          field_id: string
          field_name: string
          source_operation: string
          operation_type: string | null
          operation_date: string | null
          cell_m: number
          point_count: number
          cell_count: number
          min_ft: number
          max_ft: number
          relief_ft: number
          /**
           * False means NO antenna correction was applied at all. Correcting
           * some machines on a pass and not others inserts a step where there
           * is none, so a partial correction is refused rather than made.
           */
          antenna_corrected: boolean
          machines: string[]
          note: string | null
          built_at: string
        }
        Relationships: []
      }
      /** One cell of a surface, with lon/lat already decoded out of the geometry. */
      field_topo_cells_v: {
        Row: {
          id: string
          surface_id: string
          field_id: string
          lon: number
          lat: number
          elev_ft: number
          /** Height above the local neighbourhood. Negative is a hollow. */
          rem_ft: number | null
          n_points: number
        }
        Relationships: []
      }
      /**
       * Per field per crop year: how wet it went in.
       *
       * Both ends are kept. The average is the number quoted to a buyer; the
       * maximum is the number that decides whether the bin needs a fan on it.
       */
      /**
       * Productivity zones with the geometry already converted for the map.
       *
       * `zone` is an ORDER within one field — 1 is that field's poorest ground —
       * and means nothing between fields, which is why anything drawing these
       * colours by yield rather than by zone number.
       */
      /** One row per OCCUPIED bin, with the crop and the bin's own details. */
      /**
       * Per ranch per feed type: put up, fed, and what is left — all in pounds.
       *
       * A bale with no weight recorded lands in `unweighed_lines` rather than
       * being counted as zero pounds, so a missing bale weight reads as a gap
       * instead of quietly shrinking the pile.
       */
      feed_on_hand: {
        Row: {
          ranch_id: string
          feed_type_id: string
          feed_name: string
          default_unit: 'lb' | 'big_square' | 'round'
          default_lb_per_bale: number | null
          is_bedding: boolean
          put_up_lb: number
          fed_lb: number
          remaining_lb: number
          unweighed_lines: number
        }
        Relationships: []
      }
      bin_contents_current: {
        Row: {
          id: string
          bin_id: string
          bin_name: string
          site: string | null
          capacity_bu: number
          crop_id: string | null
          crop_name: string | null
          variety: string | null
          crop_year: number
          bushels: number | null
          note: string | null
          filled_on: string | null
        }
        Relationships: []
      }
      field_yield_zones_geojson: {
        Row: {
          id: string
          field_id: string
          field_name: string
          zone: number
          min_yield: number | null
          max_yield: number | null
          /** Null where the source file never said what the numbers were in. */
          yield_unit: string | null
          acres: number | null
          legal_desc: string | null
          source_file: string | null
          source_name: string | null
          geometry: Json
        }
        Relationships: []
      }
      field_harvest_moisture: {
        Row: {
          field_id: string
          crop_year: number
          crop_id: string | null
          tests: number
          avg_pct: number
          max_pct: number
          min_pct: number
          last_tested_at: string
          any_above_dry: boolean
          harvest_recorded: boolean
        }
        Relationships: []
      }
      field_season_progress: {
        Row: {
          field_id: string
          field_name: string
          crop_year: number
          /** Mapped acres of the current boundary — NOT crop_plans.planned_acres. */
          acres: number
          crop_name: string | null
          seeded_annually: boolean
          harvested_crop: boolean
          has_seeding: boolean
          has_harvest: boolean
          /** Any Deere operation this season, however small. */
          has_any_operation: boolean
        }
        Relationships: []
      }
      crop_position: {
        Row: {
          crop_year: number
          crop_id: string
          crop_name: string | null
          yield_unit: 'bu' | 'lbs' | 'cwt' | 'ton' | 'MT' | 'ac'
          crop_category: 'seed' | 'commercial' | 'own_use' | null
          acres: number
          expected: number
          contracted: number
          contracted_value: number
          delivered: number
          contract_count: number
          onhand: number
          open_quantity: number
          oversold: number | null
          avg_contract_price: number | null
          clean_acres: number | null
          pre_clean_acres: number | null
        }
        Relationships: []
      }
      /** Each cash bid against the board it was quoted on. */
      crop_basis: {
        Row: {
          id: string
          crop_id: string
          crop_name: string
          buyer: string
          bid_on: string
          price_per_unit: number
          unit: string
          delivery_month: string | null
          location: string | null
          series_id: string | null
          contract_month: string | null
          futures_value: number | null
          basis: number | null
        }
        Relationships: []
      }
      /**
       * One row per product per application: which field, which day, at what
       * rate. Read-only; the flattening lives in the view, not in the client.
       */
      product_applications: {
        Row: {
          operation_id: string
          product_id: string | null
          applied_name: string
          field_id: string | null
          field_name: string | null
          applied_on: string | null
          crop_season: number | null
          operator_name: string | null
          mix_name: string | null
          from_mix: boolean | null
          rate_value: number | null
          rate_unit: string | null
          applied_at: string
        }
        Relationships: []
      }
      /**
       * Per-turbine leak verdict. Pressure decay while the pump is idle, plus
       * the panel's own line-full bit, which is the only unambiguous signal —
       * the flow meter reads 0 even with a pivot watering.
       */
      plc_line_integrity: {
        Row: {
          plc_pump: number
          muted: boolean
          muted_reason: string | null
          decay_limit: number | string
          running_now: boolean | null
          full_now: boolean | null
          psi_now: number | string | null
          psi_read_at: string | null
          last_running_at: string | null
          psi_start: number | string | null
          psi_start_at: string | null
          lost_full_while_idle: boolean
          idle_hours: number | string | null
          psi_drop: number | string | null
          /** PSI lost per hour while idle. Null until half an hour of idle. */
          decay_rate: number | string | null
          status: 'ok' | 'watch' | 'leak' | 'muted' | 'running' | 'settling' | 'unknown'
        }
        Relationships: []
      }
      plc_turbine_fields: {
        Row: {
          /** 1 or 2 — which turbine on the Twido. */
          plc_pump: number
          pump_id: string
          pump_name: string
          horse_power: number | string | null
          gpm: number | string | null
          fields: { id: string; name: string }[]
        }
        Relationships: []
      }
      plc_agent_health: {
        Row: {
          device_id: string
          device_key: string
          device_label: string
          connection_state: string
          agent_version: string | null
          agent_host: string | null
          last_seen_at: string | null
          last_poll_at: string | null
          tags_good: number | null
          tags_bad: number | null
          reconnects: number | null
          failures: number | null
          last_error: string | null
          /** Measured by Postgres, so a wrong clock on a phone cannot lie about it. */
          seen_seconds_ago: number | null
        }
        Relationships: []
      }
      plc_live: {
        Row: {
          device_id: string
          device_key: string
          device_label: string
          tag: string
          tag_label: string
          unit: string | null
          data_type: string
          writable: boolean
          min_value: number | string | null
          max_value: number | string | null
          description: string | null
          value_num: number | string | null
          value_bool: boolean | null
          value_text: string | null
          quality: 'good' | 'bad' | null
          error: string | null
          raw: Json
          read_at: string | null
          /** When the value above was measured, as opposed to last attempted. */
          last_good_at: string | null
          /** Since the last attempt. The "is the link alive" number. */
          age_seconds: number | null
          /** Since the value was measured. The one that belongs beside it. */
          value_age_seconds: number | null
        }
        Relationships: []
      }
      pasture_water_points: {
        Row: { pasture_id: string; name: string; lat: number; lon: number }
        Relationships: []
      }
      pasture_underutilisation: {
        Row: {
          pasture_id: string
          name: string
          near_look: string | null
          far_look: string | null
          near_water_ndvi: number | string | null
          far_water_ndvi: number | string | null
          ndvi_gap: number | string | null
          far_water_acres: number | string | null
          same_day: boolean
          finding: string
          actionable: boolean
        }
        Relationships: []
      }
      pasture_rotation_order: {
        Row: {
          pasture_id: string
          name: string
          area_acres: number | string | null
          last_look: string | null
          days_since_look: number | null
          forage_index: number | string | null
          percent_of_best: number | string | null
          regrowth_per_day: number | string | null
          regrowth_points: number | null
          days_rested: number | null
          min_rest_days: number
          cattle_on_now: boolean | null
          readiness: 'not_ready' | 'ready' | 'optimal' | 'overmature' | 'overgrazed'
          readiness_reason: string
          rotation_score: number | string | null
          caveat: string | null
        }
        Relationships: []
      }
      pasture_calibration_readiness: {
        Row: {
          samples: number
          low_samples: number
          mid_samples: number
          high_samples: number
          pastures_sampled: number
          seasons: number
          may_report_absolute: boolean
        }
        Relationships: []
      }
      cattle_water_points: {
        Row: {
          id: string
          name: string | null
          kind: 'dugout' | 'pond' | 'trough' | 'spring' | 'well' | 'other'
          drinkable: boolean
          source: 'mymap' | 'manual'
          notes: string | null
          created_at: string
          updated_at: string
          lon: number | string
          lat: number | string
          pasture_id: string | null
          pasture_name: string | null
          serves: string[] | null
        }
        Relationships: []
      }
      /** The ground within 800 m of drinkable water (and the river where a pasture fronts it), per pasture. */
      pasture_water_reach_geojson: {
        Row: {
          pasture_id: string
          name: string
          river_access: 'none' | 'all' | 'north_of'
          river_access_ref: string | null
          reach_geojson: Json | null
          beyond_geojson: Json | null
          reach_acres: number | string | null
          beyond_acres: number | string | null
        }
        Relationships: []
      }
      /** Every paddock's readiness, occupied ones included; the rotation order is this minus them. */
      pasture_readiness_now: {
        Row: {
          pasture_id: string
          name: string
          area_acres: number | string | null
          last_look: string | null
          days_since_look: number | null
          forage_index: number | string | null
          percent_of_best: number | string | null
          regrowth_per_day: number | string | null
          regrowth_points: number | null
          cattle_on_now: boolean | null
          last_moved_out: string | null
          days_rested: number | null
          min_rest_days: number | null
          harvest_efficiency: number | string | null
          grazing_system: string | null
          ndre_slope: number | string | null
          readiness: 'overgrazed' | 'not_ready' | 'ready' | 'optimal' | 'overmature' | null
          readiness_reason: string | null
        }
        Relationships: []
      }
      pasture_map: {
        Row: {
          id: string
          name: string
          ranch: string | null
          pasture_type: string | null
          area_acres: number | string | null
          satellite_enabled: boolean
          geojson: Json
          /** Null until the satellite ingestion runs. Null means no imagery. */
          ndvi: number | string | null
          biomass_kg_dm_ha: number | string | null
          days_since_observation: number | null
          confidence: 'high' | 'medium' | 'low' | null
          ndvi_day: string | null
        }
        Relationships: []
      }
      field_satellite: {
        Row: {
          field_id: string
          name: string
          satellite_enabled: boolean
          ndvi: number | string | null
          fcover: number | string | null
          days_since_observation: number | null
          confidence: 'high' | 'medium' | 'low' | null
          ndvi_day: string | null
          last_observed_on: string | null
        }
        Relationships: []
      }
      sat_latest_image: {
        Row: {
          subject_type: string
          subject_id: string
          kind: string
          sensed_on: string
          storage_path: string
          west: number | string
          south: number | string
          east: number | string
          north: number | string
          collection: string
          days_old: number
          stretch_min: number | string | null
          stretch_max: number | string | null
        }
        Relationships: []
      }
      sat_zone_readiness: {
        Row: {
          field_id: string
          name: string
          qualifying_seasons: number
          best_season_looks: number
          total_full_looks: number
          zones_may_be_generated: boolean
        }
        Relationships: []
      }
      field_points: {
        Row: { id: string; name: string; lat: number; lng: number }
        Relationships: []
      }
      farm_trails_geojson: {
        Row: { id: string; name: string; note: string | null; source: string; updated_at: string; geometry: Json; length_m: number }
        Relationships: []
      }
      bin_grain_onhand: {
        Row: { bin_id: string; crop_id: string | null; onhand_bu: number }
        Relationships: []
      }
      input_onhand: {
        Row: { input_item_id: string; onhand: number; total_purchased_cost: number }
        Relationships: []
      }
      integration_status_v: {
        Row: {
          provider: string
          status: string
          external_org_name: string | null
          connected_at: string | null
          last_sync_at: string | null
          last_error: string | null
          meta: Json | null
        }
        Relationships: []
      }
      soil_reports_needing_assessment: {
        Row: {
          report_id: string
          field_id: string
          crop_year: number
          has_assessment: boolean
          generated_at: string | null
        }
        Relationships: []
      }
      field_boundaries_geojson: {
        Row: {
          id: string
          field_id: string
          geometry: Json
          valid_from: string
          valid_to: string | null
          source: BoundarySource
          acres: number
        }
        Relationships: []
      }
      tasks_with_assignees: {
        Row: Database['public']['Tables']['tasks']['Row'] & {
          /** Everyone on the task, by full name. Empty rather than null. */
          assignee_ids: string[]
        }
        Relationships: []
      }
      bins_located: {
        Row: {
          id: string
          name: string
          site: string | null
          capacity_bu: number | null
          notes_md: string | null
          active: boolean
          /** Advisory: any bin can take any crop, this is just what it usually holds. */
          usual_contents: 'grain' | 'fertilizer'
          /** Null until somebody drops its pin on the map. */
          lng: number | null
          lat: number | null
        }
        Relationships: []
      }
      field_centroids: {
        Row: { field_id: string; lat: number | null; lon: number | null }
        Relationships: []
      }
      field_ndre: {
        Row: {
          field_id: string
          ndre_mean: number | string | null
          sensed_on: string
          days_since: number
        }
        Relationships: []
      }
      field_soil_units: {
        Row: {
          field_id: string
          poly_id: number
          munit: string | null
          soil_name: string | null
          subgroup: string | null
          drainage: string | null
          salinity: string | null
          texture_top: string | null
          fc_pct: number | string | null
          wp_pct: number | string | null
          detail: Json
          overlap_acres: number | string | null
          pct_of_field: number | string | null
        }
        Relationships: []
      }
      soil_landscape_geojson: {
        Row: {
          id: string
          poly_id: number
          munit: string | null
          soil_name: string | null
          soil_code: string | null
          subgroup: string | null
          drainage: string | null
          salinity: string | null
          texture_top: string | null
          fc_pct: number | string | null
          wp_pct: number | string | null
          acres: number | string | null
          detail: Json
          geometry: Json
        }
        Relationships: []
      }
      water_features_geojson: {
        Row: {
          id: string
          kind: string
          layer: string
          name: string | null
          geometry: Json
        }
        Relationships: []
      }
      water_setbacks_geojson: {
        Row: {
          id: string
          kind: string
          name: string | null
          geometry: Json
        }
        Relationships: []
      }
      fertility_rx_map_geojson: {
        Row: {
          id: string
          field_id: string
          crop_year: number
          product: string | null
          target_rate: number | string | null
          acres: number | string | null
          source_file: string | null
          geometry: Json
        }
        Relationships: []
      }
    }
    Functions: {
      /** The week's alerts for the Monday meeting, farm-wide, each kind + title once. */
      meeting_alerts: {
        Args: { p_from: string; p_to: string; p_kinds: string[] }
        Returns: { kind: string; title: string; body: string | null; link: string | null; last_at: string; times: number }[]
      }
      /** The farm's id, creating the farms row first if the database has none (a new install). */
      ensure_farm: {
        Args: Record<string, never>
        Returns: string
      }
      /** The farm's name and logo, readable before sign-in (login page). */
      public_brand: {
        Args: Record<string, never>
        Returns: { farm_name: string | null; app_name: string | null; short_name: string | null; logo_url: string | null; province: string | null; support_email: string | null }[]
      }      /** Saves a feed sheet and its lines in one transaction; returns the record id. */
      save_feed_record: {
        Args: { p_record: Record<string, unknown>; p_lines: Record<string, unknown>[] }
        Returns: string
      }
      /** Re-derive every field's soil water-holding from its own soil samples (N-year average). */
      fn_refresh_soil_from_samples: {
        Args: { p_years?: number }
        Returns: number
      }
      /** Passes on a field hidden as copies of another job. */
      jd_duplicate_operations: {
        Args: { p_field: string }
        Returns: Database['public']['Tables']['jd_field_operations']['Row'][]
      }
      /** Mark a pass a copy of p_of, or (p_of null) its own job. Managers only. */
      /** Re-mark which sprays are ours after a tenure change. Managers only. */
      jd_reclassify: {
        Args: Record<string, never>
        Returns: number
      }
      jd_unconfirmed_operations: {
        Args: { p_field?: string | null }
        Returns: { id: string; field_id: string; field_name: string; started_at: string; product: string | null; jd_id: string }[]
      }
      jd_confirm_operation: {
        Args: { p_id: string; p_applied: boolean }
        Returns: undefined
      }
      jd_set_not_ours: {
        Args: { p_id: string; p_kind: string | null; p_note?: string | null }
        Returns: undefined
      }
      jd_set_duplicate: {
        Args: { p_id: string; p_of: string }
        Returns: undefined
      }
      n_trial_strips: {
        Args: { p_trial: string }
        Returns: { strip: number; rep: number; rate: number; geojson: Json; acres: number; heading: number }[]
      }
      create_n_rich_strip: {
        Args: { p_field: string; p_year: number; p_width_m?: number; p_offset_m?: number; p_extra_lb?: number; p_heading_deg?: number | null }
        Returns: string
      }
      /** Save this device's push subscription to whoever is signed in. */
      save_push_subscription: {
        Args: { p_endpoint: string; p_p256dh: string; p_auth: string }
        Returns: undefined
      }
      /** A test notification to yourself. */
      send_test_notification: {
        Args: Record<string, never>
        Returns: undefined
      }
      /** Drop a person's yield override and go back to the scale loads' figure. */
      use_scale_yield: {
        Args: { p_history: string }
        Returns: undefined
      }
      /** Fold one price-book row into another; see merge_jd_products. */
      merge_jd_products: {
        Args: { p_keep: string; p_drop: string; p_force?: boolean }
        Returns: undefined
      }
      /**
       * Every cell of one surface as [lon, lat, elev_ft, rem_ft, n_points].
       * One row, so PostgREST's 1000-row cap cannot cut a field short.
       */
      topo_cells: {
        Args: { p_surface: string }
        Returns: [number, number, number, number | null, number][]
      }
      /** Each gridded Profit/Loss layer of a season, summed. */
      pl_layer_totals: {
        Args: { p_year: number }
        Returns: {
          operation_id: string | null
          field_id: string
          operation_type: string
          kind: 'input' | 'yield' | 'coverage'
          product_name: string | null
          rate_unit: string | null
          rate_acres: number
          covered_acres: number
          cell_count: number
        }[]
      }
      /**
       * Get or assign this week's meeting fact.
       *
       * Candidates arrive in priority order from the client — the library lives
       * in the repo — and the first never-used one is recorded and returned in
       * the same call, so two people opening the meeting get the same answer.
       * Null means every candidate has already been read out.
       */
      assign_meeting_fact: {
        Args: { p_week: string; p_candidates: string[]; p_reassign?: boolean }
        Returns: string | null
      }
      /**
       * Drop a written fact for good, and free the week that was holding it.
       *
       * The safety valve on a library that refills itself: a fact that is wrong
       * leaves the pool permanently and the week picks again on the spot.
       */
      retire_meeting_fact: { Args: { p_id: string }; Returns: undefined }
      is_manager: { Args: Record<string, never>; Returns: boolean }
      is_admin: { Args: Record<string, never>; Returns: boolean }
      is_owner: { Args: Record<string, never>; Returns: boolean }
      can_see_finances: { Args: Record<string, never>; Returns: boolean }
      /** Acres in a year's crop plan: planned acres, else the drawn boundary. */
      farm_plan_acres: { Args: { p_year: number }; Returns: number }
      /** Acres of land rented out (Hytech's) that carry the land share of the fixed expenses. */
      farm_rented_out_acres: { Args: { p_year: number }; Returns: number }
      /** The fixed $/ac a year is charged: its own setting, else the latest earlier one. */
      farm_fixed_per_acre: { Args: { p_year: number }; Returns: number | null }
      user_invite_status: {
        Args: Record<string, never>
        Returns: { id: string; invited_at: string | null; last_sign_in_at: string | null }[]
      }
      is_active: { Args: Record<string, never>; Returns: boolean }
      set_bin_location: {
        Args: { p_bin_id: string; p_lng: number | null; p_lat: number | null }
        Returns: undefined
      }
      replace_boundary: {
        Args: { p_field_id: string; p_geojson: Json; p_source: BoundarySource }
        Returns: string
      }
      get_field_audit: {
        Args: { p_field_id: string }
        Returns: {
          id: number
          table_name: string
          record_id: string
          action: string
          actor_id: string | null
          actor_role: string | null
          changed_at: string
          old_values: Json | null
          new_values: Json | null
          crop_year: number | null
        }[]
      }
      create_checklist_run: {
        Args: {
          p_template_id: string
          p_assigned_to: string[]
          p_due_at?: string | null
          p_crop_year?: number | null
        }
        Returns: string
      }
      fn_apply_hail_inspection: {
        Args: { p_id: string }
        Returns: undefined
      }
      ensure_monthly_instances: {
        Args: { p_year: number }
        Returns: Database['public']['Tables']['monthly_task_instances']['Row'][]
      }
      rebuild_pasture_zones: {
        Args: Record<string, never>
        Returns: number
      }
      import_pasture_water: {
        Args: { p_points: never }
        Returns: { pastures_updated: number; points_matched: number; points_outside: number }[]
      }
    }
    Enums: {
      user_role: UserRole
      boundary_source: BoundarySource
      layer_type: LayerType
      field_file_kind: FieldFileKind
      yield_unit: YieldUnit
      history_source: HistorySource
      bin_policy: BinPolicy
      input_category: InputCategory
    }
    CompositeTypes: Record<string, never>
  }
}
