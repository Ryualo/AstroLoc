/**
 * AstroLoc Phase 1 — Scientific Data Provenance Schema, Dataset Registry,
 * and Audited Mars & Moon Reference Benchmarks (D1–D5).
 */
(function (root) {
  'use strict';

  const EVIDENCE_CLASSIFICATION = Object.freeze({
    MEASURED: 'Measured',
    DERIVED: 'Derived',
    INFERRED: 'Inferred',
    SIMULATED: 'Simulated',
    UNAVAILABLE: 'Unavailable'
  });

  const EVIDENCE_TO_LEGACY_TAG = Object.freeze({
    Measured: 'measured',
    Derived: 'derived',
    Inferred: 'inferred',
    Simulated: 'simulated',
    Unavailable: 'unknown',
    measured: 'measured',
    derived: 'derived',
    inferred: 'inferred',
    simulated: 'simulated',
    unavailable: 'unknown',
    unknown: 'unknown'
  });

  const ASTROLOC_DATASET_REGISTRY = Object.freeze({
    MGS_MOLA_MEGDR: {
      datasetName: 'Mars Global Surveyor MOLA Mission Experiment Gridded Data Record (MEGDR)',
      provider: 'NASA / GSFC / PDS Geosciences Node',
      url: 'https://pds-geosciences.wustl.edu/missions/mgs/megdr.html',
      retrievalDate: '2026-11-14',
      spatialResolution: '463 m/pixel (128 pixels/deg)',
      temporalCoverage: '1999–2001 (MGS Mapping Mission)',
      units: 'm, deg',
      processingMethod: 'Laser altimetry topographic gridding and baseline slope calculation (Smith et al., 2001; Kreslavsky & Head, 2000)'
    },
    ODYSSEY_GRS_APXS: {
      datasetName: '2001 Mars Odyssey Gamma Ray Spectrometer (GRS) & MER/MSL APXS Elemental Synthesis',
      provider: 'NASA / Lunar and Planetary Laboratory / PDS Geosciences Node',
      url: 'https://pds-geosciences.wustl.edu/missions/odyssey/grs.html',
      retrievalDate: '2026-11-14',
      spatialResolution: '5° x 5° (~300 km orbital footprint) & In-situ Rover Contact (<2 cm)',
      temporalCoverage: '2002–2024',
      units: 'wt%',
      processingMethod: 'Gamma-ray spectroscopy elemental abundance inversion and APXS oxide summation (Boynton et al., 2007; Taylor & McLennan, 09)'
    },
    MRO_CRISM_TES: {
      datasetName: 'MRO Compact Reconnaissance Imaging Spectrometer for Mars (CRISM) & MGS TES Mineralogy',
      provider: 'NASA / JHU APL / Arizona State University / PDS',
      url: 'https://pds-geosciences.wustl.edu/missions/mro/crism.htm',
      retrievalDate: '2026-11-14',
      spatialResolution: '18–36 m/pixel (CRISM Targeted) / 3 km (MGS TES)',
      temporalCoverage: '1997–2023',
      units: 'spectral_parameter, modal_%',
      processingMethod: 'VNIR/IR reflectance and thermal emission spectral unmixing (Murchie et al., 2009; Bandfield, 2002)'
    },
    MSL_REMS_THEMIS: {
      datasetName: 'MSL Curiosity Rover Environmental Monitoring Station (REMS), Phoenix WCL & Odyssey THEMIS',
      provider: 'NASA / JPL / CAB Spain / PDS Atmospheres & Geosciences Nodes',
      url: 'https://pds-atmospheres.nmsu.edu/data_and_services/atmospheres_data/MARS/curiosity.html',
      retrievalDate: '2026-11-14',
      spatialResolution: 'In-situ Lander/Rover Point & 100 m/pixel IR (THEMIS)',
      temporalCoverage: '2002–2026',
      units: '°C, K, W/m², pH, wt%',
      processingMethod: 'Ground-level meteorological, UV photodiode (200–380 nm), and wet chemistry cell telemetry (Martínez et al., 2017; Hecht et al., 2009)'
    },
    MSL_RAD_MRO_HIRISE_PITS: {
      datasetName: 'MSL Radiation Assessment Detector (RAD) & MRO HiRISE / Odyssey THEMIS Candidate Cave Pit Catalog',
      provider: 'NASA / SwRI / USGS Astrogeology Science Center',
      url: 'https://www.usgs.gov/centers/astrogeology-science-center',
      retrievalDate: '2026-11-14',
      spatialResolution: '0.25–0.50 m/pixel (HiRISE Orbital Imagery) / Point Dosimetry (RAD)',
      temporalCoverage: '2006–2025',
      units: 'm, mSv/yr',
      processingMethod: 'Orbital pit diameter/overhang photogrammetry and HZETRN regolith radiation attenuation modeling (Hassler et al., 2014; Cushing, 2012)'
    },
    LRO_LOLA_DEM: {
      datasetName: 'Lunar Reconnaissance Orbiter (LRO) Lunar Orbiter Laser Altimeter (LOLA) GDR',
      provider: 'NASA / GSFC / PDS Geosciences Node',
      url: 'https://pds-geosciences.wustl.edu/missions/lro/lola.htm',
      retrievalDate: '2026-11-14',
      spatialResolution: '5–100 m/pixel',
      temporalCoverage: '2009–2025',
      units: 'm, deg',
      processingMethod: 'Multi-beam laser altimetry bidirectional slope and RMS roughness derivation (Smith et al., 2010; Rosenburg et al., 2011)'
    },
    LRO_DIVINER_THERMAL: {
      datasetName: 'LRO Diviner Lunar Radiometer Experiment Global Bolometric Temperature',
      provider: 'NASA / UCLA / PDS Geosciences Node',
      url: 'https://pds-geosciences.wustl.edu/missions/lro/diviner.htm',
      retrievalDate: '2026-11-14',
      spatialResolution: '200–320 m/pixel',
      temporalCoverage: '2009–2025',
      units: '°C, K',
      processingMethod: 'Seven-channel infrared radiometry bolometric brightness temperature integration (Paige et al., 2010; Williams et al., 2017)'
    },
    APOLLO_LP_M3_GEOCHEM: {
      datasetName: 'Apollo/Luna Sample Return Reference Suite, Lunar Prospector GRS & Chandrayaan-1 M3',
      provider: 'NASA JSC Astromaterials / Brown University / PDS',
      url: 'https://curator.jsc.nasa.gov/lunar/',
      retrievalDate: '2026-11-14',
      spatialResolution: 'Laboratory Sample & 140 m/pixel (M3) / 60 km (LP-GRS)',
      temporalCoverage: '1969–2024',
      units: 'wt%, modal_%',
      processingMethod: 'XRF/ICP-MS bulk oxide analysis and orbital VNIR/gamma-ray compositional mapping (Prettyman et al., 2006; Pieters et al., 2009)'
    },
    LRO_MINIRF_LCROSS_SUBSURFACE: {
      datasetName: 'LRO LROC NAC Mare Pit Catalog, Mini-RF Radar & LCROSS Polar Plume Impact',
      provider: 'NASA / ASU / JHU APL / NASA Ames',
      url: 'https://pds.lroc.asu.edu/',
      retrievalDate: '2026-11-14',
      spatialResolution: '0.5 m/pixel (LROC NAC) / 15 m (Mini-RF)',
      temporalCoverage: '2009–2024',
      units: 'm, wt%',
      processingMethod: 'Oblique NAC shadow-geometry modeling, radar coherent backscatter, and NIR plume spectroscopy (Wagner & Robinson, 2014; Carrer et al., 2024; Colaprete et al., 2010)'
    },
    NASA_POWER_MERRA2: {
      datasetName: 'NASA POWER MERRA-2 Climatology (T2M, T2M_MIN, T2M_MAX, PRECTOTCORR, ALLSKY_SFC_UV_INDEX)',
      provider: 'NASA Langley Research Center (LaRC)',
      url: 'https://power.larc.nasa.gov/api/temporal/climatology/point',
      retrievalDate: '2026-11-14',
      spatialResolution: '0.5° x 0.625° (~50 km grid)',
      temporalCoverage: '1984–2024 Multi-Decadal Climatology',
      units: '°C, K, mm/yr, UV_Index',
      processingMethod: 'Satellite-assimilated MERRA-2 atmospheric reanalysis and CERES surface radiative flux'
    },
    COPERNICUS_GLO30: {
      datasetName: 'Copernicus DEM GLO-30 (via Open-Meteo Elevation API)',
      provider: 'European Space Agency (ESA) / Open-Meteo',
      url: 'https://api.open-meteo.com/v1/elevation',
      retrievalDate: '2026-11-14',
      spatialResolution: '30 m (1 arc-second)',
      temporalCoverage: '2011–2015 TanDEM-X Acquisition',
      units: 'm ASL, deg',
      processingMethod: '3x3 Horn (1981) finite-difference gradient and local relief derivation at 0.0025° step'
    },
    USGS_3DEP_EPQS: {
      datasetName: 'USGS 3D Elevation Program (3DEP) Elevation Point Query Service',
      provider: 'U.S. Geological Survey (USGS)',
      url: 'https://epqs.nationalmap.gov/v1/json',
      retrievalDate: '2026-11-14',
      spatialResolution: '1–10 m (1/3 arc-second LiDAR/IfSAR)',
      temporalCoverage: '2012–2025',
      units: 'm ASL',
      processingMethod: 'Direct bilinear interpolation on high-resolution airborne LiDAR/DEM tiles'
    },
    OPEN_METEO_ERA5: {
      datasetName: 'ECMWF ERA5-Land Historical Reanalysis Archive',
      provider: 'ECMWF / Copernicus / Open-Meteo',
      url: 'https://archive-api.open-meteo.com/v1/archive',
      retrievalDate: '2026-11-14',
      spatialResolution: '9 km (0.1° ERA5-Land grid)',
      temporalCoverage: '2019-01-01 to 2023-12-31 (5 Full Calendar Years)',
      units: '°C, K, mm/yr',
      processingMethod: 'Multi-year historical daily aggregation of 2 m air temperature and complete-year precipitation sum'
    },
    MACROSTRAT_V2: {
      datasetName: 'Macrostrat Geologic Map Service v2',
      provider: 'University of Wisconsin–Madison / NSF Geoinformatics',
      url: 'https://macrostrat.org/api/v2/geologic_units/map',
      retrievalDate: '2026-11-14',
      spatialResolution: '1:24,000 to 1:1,000,000 Regional Map Polygons',
      temporalCoverage: 'Compiled Phanerozoic–Precambrian Bedrock Maps',
      units: 'categorical_lithology',
      processingMethod: 'Point-in-polygon spatial query and keyword lithology classification'
    },
    TERRESTRIAL_PEER_REVIEWED_FIELD: {
      datasetName: 'Peer-Reviewed Terrestrial Analog Field Campaigns & Geochemical Surveys',
      provider: 'Academic Literature & NASA PSTAR / ASTEP / BASALT / BRAILLE Field Archives',
      url: 'https://astrobiology.nasa.gov/research/field-sites/',
      retrievalDate: '2026-11-14',
      spatialResolution: 'In-situ Outcrop / Sample Scale (0.01–100 m)',
      temporalCoverage: '1963–2024 Published Field Studies',
      units: 'wt%, pH, m, dimensionless_index',
      processingMethod: 'XRF/XRD bulk geochemistry, in-situ pH/salinity metering, and literature-derived fidelity indexing'
    },
    FACILITY_SIMULATION_SPECS: {
      datasetName: 'Controlled Analog Habitat, Simulant Testbed & Isolation Facility Engineering Specifications',
      provider: 'NASA JSC (CHAPEA/NBL) / ESA (EAC-LUNA) / Mars Society / IBMP / University of Arizona',
      url: 'https://www.nasa.gov/humans-in-space/chapea/',
      retrievalDate: '2026-11-14',
      spatialResolution: 'Facility Micro-Scale (<1–50 m)',
      temporalCoverage: '2001–2025 Operational Missions',
      units: 'm, wt%, °C',
      processingMethod: 'Engineered habitat telemetry and synthetic regolith simulant specifications'
    },
    OFFLINE_TRIG_FALLBACK: {
      datasetName: 'Deterministic Latitude/Longitude Trigonometric Estimator',
      provider: 'AstroLoc Client Offline Fallback',
      url: 'local://offline-estimator',
      retrievalDate: '2026-11-14',
      spatialResolution: 'Synthetic Mathematical Surface (Non-Observational)',
      temporalCoverage: 'None (Time-Invariant Formula)',
      units: 'm, deg, °C, mm/yr',
      processingMethod: 'Harmonic sine/cosine latitude-longitude approximation (Strictly Simulated)'
    }
  });

  function createMetricProvenance(evidenceClass, datasetKey, units, processingMethodOverride, notes) {
    const validClass = Object.values(EVIDENCE_CLASSIFICATION).includes(evidenceClass)
      ? evidenceClass
      : EVIDENCE_CLASSIFICATION.UNAVAILABLE;
    const ds = ASTROLOC_DATASET_REGISTRY[datasetKey] || null;
    return {
      evidenceClass: validClass,
      legacyTag: EVIDENCE_TO_LEGACY_TAG[validClass] || 'unknown',
      datasetName: ds ? ds.datasetName : 'Unavailable / Unspecified Dataset',
      provider: ds ? ds.provider : 'None',
      url: ds ? ds.url : '',
      retrievalDate: ds ? ds.retrievalDate : '2026-11-14',
      spatialResolution: ds ? ds.spatialResolution : 'N/A',
      temporalCoverage: ds ? ds.temporalCoverage : 'N/A',
      units: units || (ds ? ds.units : ''),
      processingMethod: processingMethodOverride || (ds ? ds.processingMethod : 'None'),
      notes: notes || null
    };
  }

  function validateSiteProvenanceRecord(site) {
    const issues = [];
    if (!site || typeof site !== 'object') {
      return { valid: false, issues: ['Site record is missing or not an object.'] };
    }
    const tags = site.epistemicTags || {};
    Object.entries(tags).forEach(([metricKey, status]) => {
      const val = site[metricKey];
      if ((val === null || val === undefined || val === '') && status !== 'unknown' && status !== 'Unavailable') {
        issues.push(`Metric "${metricKey}" is null/empty but tagged as "${status}" instead of Unavailable/unknown.`);
      }
    });
    if (/CRISM|THEMIS|LROC|MOLA|LOLA/i.test(site.datasets || '')) {
      issues.push(`Site "${site.name}" references planetary orbital sensors in terrestrial datasets string.`);
    }
    return { valid: issues.length === 0, issues };
  }

  const PLANETARY_REFERENCE_BENCHMARKS = {
    MARS: {
      id: 'MARS',
      name: 'Mars',
      badgeColor: '#f97316',
      sensors: 'MGS MOLA • Mars Odyssey GRS & THEMIS • MRO CRISM & HiRISE • MSL REMS, RAD & CheMin • Phoenix WCL',
      description: 'Fe/Mg-rich basaltic crust (26.7 wt% FeO+MgO) with localized Noachian/Hesperian phyllosilicate and sulfate basins, hyper-arid CO2 atmosphere (-63°C mean, 0 mm/yr liquid precip), orbital candidate lava tube skylights, and high-UV perchlorate regolith.',
      referenceDossier: {
        d1_geology: {
          feMgOxideSumWtPct: {
            value: 26.7,
            range: [22.0, 29.5],
            provenance: createMetricProvenance(
              EVIDENCE_CLASSIFICATION.MEASURED,
              'ODYSSEY_GRS_APXS',
              'wt%',
              'Global Mars Odyssey GRS upper-crustal mean (~18.1 wt% FeOT + ~8.6 wt% MgO) corroborated by Spirit, Opportunity, and Curiosity APXS',
              'Direct orbital GRS and rover APXS measurement (Boynton et al., 2007; Taylor & McLennan, 2009).'
            )
          },
          normativeMaficIndexPct: {
            value: 58,
            range: [45, 70],
            provenance: createMetricProvenance(
              EVIDENCE_CLASSIFICATION.DERIVED,
              'MRO_CRISM_TES',
              '%',
              'Literature-derived modal/normative mafic mineral fraction (olivine + pyroxene + Fe-Ti oxides vs plagioclase and amorphous/phyllosilicate phases)',
              'Composite index derived from TES/CRISM spectral deconvolutions and SNC/rover petrology (McSween et al., 2009).'
            )
          },
          diagnosticMinerals: {
            value: ['olivine', 'pyroxene', 'plagioclase', 'ilmenite', 'sulfates', 'phyllosilicates', 'hematite', 'halite_perchlorate', 'opal_silica', 'palagonite'],
            provenance: createMetricProvenance(
              EVIDENCE_CLASSIFICATION.MEASURED,
              'MRO_CRISM_TES',
              'mineral_assemblage',
              'Orbital VNIR/TIR spectroscopy (CRISM/TES) and in-situ XRD/wet chemistry (MSL CheMin, Phoenix WCL)',
              'Palagonite is a poorly crystalline terrestrial volcanic tephra analog for Martian NP-Ox/allophanic dust.'
            )
          }
        },
        d2_topography: {
          globalMedianSlopeDeg: {
            value: 1.8,
            analogTargetSlopeDeg: 8.5,
            range: [0.5, 25.0],
            provenance: createMetricProvenance(
              EVIDENCE_CLASSIFICATION.MEASURED,
              'MGS_MOLA_MEGDR',
              'deg',
              'MOLA 463 m baseline global median slope is ~1.8°; 8.5° represents the literature-derived 5–30 m rover-scale cratered/volcanic hazard benchmark (HiRISE)',
              'UNCERTAINTY FLAG: Planetary slope is strongly baseline-dependent.'
            )
          },
          localReliefMeters: {
            value: 320,
            range: [50, 2500],
            provenance: createMetricProvenance(
              EVIDENCE_CLASSIFICATION.DERIVED,
              'MGS_MOLA_MEGDR',
              'm',
              'Representative 1–5 km window relief across Martian cratered highlands, volcanic shields, and paleolake margins',
              'High regional variance between northern lowlands and highland craters.'
            )
          }
        },
        d3_thermal: {
          meanSurfaceTempC: {
            value: -63.0,
            range: [-125.0, -20.0],
            provenance: createMetricProvenance(
              EVIDENCE_CLASSIFICATION.MEASURED,
              'MSL_REMS_THEMIS',
              '°C',
              'Global bolometric mean surface temperature (~210 K / -63°C) measured by Viking IRTM, MGS TES, Odyssey THEMIS, and MSL REMS'
            )
          },
          extremeMinTempC: {
            value: -95.0,
            globalPolarMinC: -143.0,
            range: [-143.0, -70.0],
            provenance: createMetricProvenance(
              EVIDENCE_CLASSIFICATION.MEASURED,
              'MSL_REMS_THEMIS',
              '°C',
              'Equatorial/mid-latitude rover nocturnal minimum (~-95°C at Gale/Jezero) and -143°C CO2 frost point at winter poles'
            )
          },
          diurnalThermalSwingK: {
            value: 70.0,
            range: [50.0, 95.0],
            provenance: createMetricProvenance(
              EVIDENCE_CLASSIFICATION.MEASURED,
              'MSL_REMS_THEMIS',
              'K',
              'Diurnal ground skin temperature amplitude measured by MSL REMS GTS and Perseverance MEDA (~65–80 K typical)'
            )
          },
          annualLiquidPrecipMmYr: {
            value: 0.0,
            provenance: createMetricProvenance(
              EVIDENCE_CLASSIFICATION.MEASURED,
              'MSL_REMS_THEMIS',
              'mm/yr',
              'Direct atmospheric pressure/temperature triple-point constraint and lander meteorology (trace frost only, zero rain)'
            )
          }
        },
        d4_subsurface: {
          directSubsurfaceMeasurementsAvailable: false,
          planetaryMeasurementStatus: EVIDENCE_CLASSIFICATION.UNAVAILABLE,
          candidateLavaTubeSkylights: {
            value: null,
            provenance: createMetricProvenance(
              EVIDENCE_CLASSIFICATION.UNAVAILABLE,
              'MSL_RAD_MRO_HIRISE_PITS',
              'idx (0–100)',
              'UNAVAILABLE IN SITU: Candidate collapse pits imaged by THEMIS/HiRISE (Cushing et al., 2007), but zero Martian caves have been entered or measured internally'
            )
          },
          cryogenicSubsurfaceIceCaves: {
            value: null,
            provenance: createMetricProvenance(
              EVIDENCE_CLASSIFICATION.UNAVAILABLE,
              'MSL_RAD_MRO_HIRISE_PITS',
              'idx (0–100)',
              'UNAVAILABLE IN SITU: Subsurface water-ice sheets detected by SHARAD radar and HiRISE scarps (Dundas et al., 2018), but accessible Martian ice caves are unconfirmed'
            )
          },
          radiationShieldingOverburdenMeters: {
            value: 6.0,
            range: [3.0, 10.0],
            provenance: createMetricProvenance(
              EVIDENCE_CLASSIFICATION.INFERRED,
              'MSL_RAD_MRO_HIRISE_PITS',
              'm',
              'Literature-derived basaltic regolith roof thickness required to attenuate GCR/SPE dose (~230 mSv/yr surface measured by MSL RAD) below terrestrial background'
            )
          }
        },
        d5_astrobiology: {
          directBiosignatureMeasurementsAvailable: false,
          planetaryMeasurementStatus: EVIDENCE_CLASSIFICATION.UNAVAILABLE,
          confirmedMartianBiosignatures: {
            value: null,
            provenance: createMetricProvenance(
              EVIDENCE_CLASSIFICATION.UNAVAILABLE,
              'MSL_REMS_THEMIS',
              'idx (0–100)',
              'UNAVAILABLE: No confirmed extant or extinct Martian biosignatures have been detected to date'
            )
          },
          surfaceUvFluxRegime: {
            value: 15.5,
            units: 'W/m² (200–400 nm UVA+UVB+UVC)',
            provenance: createMetricProvenance(
              EVIDENCE_CLASSIFICATION.MEASURED,
              'MSL_REMS_THEMIS',
              'W/m²',
              'Direct MSL REMS UV sensor measurement at Gale Crater including unattenuated germicidal UVC (200–280 nm)'
            )
          },
          regolithGeochemicalPhAndSalts: {
            phRange: [3.2, 7.7],
            perchlorateWtPct: 0.5,
            provenance: createMetricProvenance(
              EVIDENCE_CLASSIFICATION.MEASURED,
              'MSL_REMS_THEMIS',
              'pH, wt%',
              'Phoenix WCL measured alkaline perchlorate soil leachate (pH 7.7 ± 0.3, ~0.4–0.6 wt% ClO4-); Opportunity Mössbauer jarosite indicates ancient acidic waters (pH ~2.5–4.0)'
            )
          }
        }
      },
      ideal: {
        maficIndex: 58,
        feMgPct: 26.7,
        preferredRocks: {
          basaltic_volcanic: 96,
          evaporitic_sulfate: 94,
          hyaloclastite_hydrothermal: 94,
          hyper_saline_regolith: 90,
          komatiite_ultramafic: 86,
          anorthosite_gabbro: 62
        },
        targetMinerals: ['olivine', 'pyroxene', 'plagioclase', 'ilmenite', 'sulfates', 'phyllosilicates', 'hematite', 'halite_perchlorate', 'palagonite', 'opal_silica'],
        meanSlope: 8.5,
        reliefTarget: 320,
        craterWeight: 0.45,
        roughnessTarget: 76,
        tempMeanTarget: -63,
        tempMinTarget: -75,
        diurnalDeltaTarget: 65,
        lavaTubeWeight: 0.55,
        iceCaveWeight: 0.45,
        shieldingTarget: 6.0,
        astroMode: 'mars_biosig'
      }
    },
    MOON: {
      id: 'MOON',
      name: 'Moon',
      badgeColor: '#38bdf8',
      sensors: 'LRO LOLA, Diviner, LROC & Mini-RF • Lunar Prospector GRS • Chandrayaan-1 M3 • LCROSS • Apollo/Luna Samples',
      description: 'Bimodal anhydrous crust of Ca-plagioclase highlands (~8.5 wt% FeO+MgO) and Fe/Ti-basaltic maria (~26.5 wt% FeO+MgO), impact-gardened regolith, extreme vacuum thermal swings (-53°C mean, ~290 K ΔT, 25–35 K polar PSRs), and mare skylight pits.',
      referenceDossier: {
        d1_geology: {
          bimodalCrustalFeMgWtPct: {
            mareBasaltMean: 26.5,
            highlandAnorthositeMean: 8.5,
            compositeBenchmark: 18.5,
            range: [5.5, 31.0],
            provenance: createMetricProvenance(
              EVIDENCE_CLASSIFICATION.MEASURED,
              'APOLLO_LP_M3_GEOCHEM',
              'wt%',
              'Apollo/Luna sample return XRF and Lunar Prospector GRS global mapping (Mare basalts: ~26.5 wt% FeO+MgO; Highlands: ~8.5 wt% FeO+MgO)'
            )
          },
          normativeMaficIndexPct: {
            mareBasaltMaficPct: 58,
            highlandAnorthositeMaficPct: 18,
            compositeBenchmark: 48,
            range: [10, 68],
            provenance: createMetricProvenance(
              EVIDENCE_CLASSIFICATION.DERIVED,
              'APOLLO_LP_M3_GEOCHEM',
              '%',
              'Modal mineralogy from Apollo sample thin sections and M3 spectral unmixing'
            )
          }
        },
        d2_topography: {
          lolaSlopeDeg: {
            mareMedianDeg: 2.0,
            highlandsMedianDeg: 7.6,
            analogTargetSlopeDeg: 11.0,
            range: [1.0, 32.0],
            provenance: createMetricProvenance(
              EVIDENCE_CLASSIFICATION.MEASURED,
              'LRO_LOLA_DEM',
              'deg',
              'LRO LOLA 17–100 m baseline bidirectional slope measurements (Rosenburg et al., 2011)'
            )
          }
        },
        d3_thermal: {
          divinerSurfaceTempC: {
            equatorialBolometricMeanC: -53.0,
            equatorialDayMaxC: 120.0,
            equatorialNightMinC: -178.0,
            polarPsrMinC: -243.0,
            provenance: createMetricProvenance(
              EVIDENCE_CLASSIFICATION.MEASURED,
              'LRO_DIVINER_THERMAL',
              '°C',
              'Direct LRO Diviner 7-channel thermal IR radiometry (Equatorial mean ~220 K / -53°C; Polar PSRs 25–35 K)'
            )
          },
          divinerDiurnalSwingK: {
            measuredEquatorialDeltaK: 290.0,
            terrestrialScalingAnchorK: 45.0,
            provenance: createMetricProvenance(
              EVIDENCE_CLASSIFICATION.MEASURED,
              'LRO_DIVINER_THERMAL',
              'K',
              'LRO Diviner measured equatorial diurnal delta is ~290 K (95 K night to 390 K noon)'
            )
          }
        },
        d4_subsurface: {
          directSubsurfaceMeasurementsAvailable: false,
          planetaryMeasurementStatus: EVIDENCE_CLASSIFICATION.UNAVAILABLE,
          mareSkylightLavaTubes: {
            value: null,
            provenance: createMetricProvenance(
              EVIDENCE_CLASSIFICATION.UNAVAILABLE,
              'LRO_MINIRF_LCROSS_SUBSURFACE',
              'idx (0–100)',
              'INFERRED FROM ORBIT ONLY: LROC oblique imagery and Mini-RF radar confirm subsurface conduit overhangs at Mare Tranquillitatis pit (Carrer et al., 2024), but no in-situ cave traversal exists'
            )
          },
          lunarIceCaves: {
            value: null,
            provenance: createMetricProvenance(
              EVIDENCE_CLASSIFICATION.UNAVAILABLE,
              'LRO_MINIRF_LCROSS_SUBSURFACE',
              'idx (0–100)',
              'UNAVAILABLE / PHYSICALLY ABSENT: LCROSS and M3 detected patchy pore/frost water ice (~1–5 wt%) in polar PSR regolith, NOT glaciokarst ice caves'
            )
          }
        },
        d5_astrobiology: {
          directBiosignatureMeasurementsAvailable: false,
          planetaryMeasurementStatus: EVIDENCE_CLASSIFICATION.UNAVAILABLE,
          lunarBiosignaturesAndBrines: {
            value: null,
            provenance: createMetricProvenance(
              EVIDENCE_CLASSIFICATION.UNAVAILABLE,
              'APOLLO_LP_M3_GEOCHEM',
              'none',
              'UNAVAILABLE: Apollo sample return confirmed the Moon is sterile, devoid of indigenous organic matter, liquid brines, or aqueous pH'
            )
          }
        }
      },
      ideal: {
        maficIndex: 48,
        feMgPct: 18.5,
        preferredRocks: {
          basaltic_volcanic: 98,
          anorthosite_gabbro: 98,
          komatiite_ultramafic: 82,
          hyaloclastite_hydrothermal: 55,
          hyper_saline_regolith: 52,
          evaporitic_sulfate: 20
        },
        targetMinerals: ['plagioclase', 'pyroxene', 'olivine', 'ilmenite'],
        hydrousPenaltyMinerals: ['sulfates', 'phyllosilicates', 'halite_perchlorate', 'opal_silica'],
        meanSlope: 11.0,
        reliefTarget: 260,
        craterWeight: 0.65,
        roughnessTarget: 88,
        tempMeanTarget: -53,
        tempMinTarget: -70,
        diurnalDeltaTarget: 45,
        lavaTubeWeight: 0.95,
        iceCaveWeight: 0.05,
        shieldingTarget: 8.0,
        astroMode: 'lunar_extremes'
      }
    }
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      EVIDENCE_CLASSIFICATION,
      EVIDENCE_TO_LEGACY_TAG,
      ASTROLOC_DATASET_REGISTRY,
      createMetricProvenance,
      validateSiteProvenanceRecord,
      PLANETARY_REFERENCE_BENCHMARKS
    };
  }
  root.AstroLocPlanetaryData = {
    EVIDENCE_CLASSIFICATION,
    EVIDENCE_TO_LEGACY_TAG,
    ASTROLOC_DATASET_REGISTRY,
    createMetricProvenance,
    validateSiteProvenanceRecord,
    PLANETARY_REFERENCE_BENCHMARKS
  };
})(typeof window !== 'undefined' ? window : globalThis);
