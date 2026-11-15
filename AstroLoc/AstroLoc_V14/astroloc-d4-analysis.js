/**
 * astroloc-d4-analysis.js
 * AstroLoc Phase 3 — D4 Water, Ice & Subsurface scientific analysis engine.
 *
 * Consumes ONLY verified Phase 2 provider envelopes (window.AstroLocD4Providers)
 * plus site telemetry already measured by the existing pipeline. Produces a
 * standardized D4 result object compatible with the discovery engine.
 *
 * SCIENTIFIC POLICY
 * - No invented formulas. Every derivation below is a documented threshold or
 *   identity from published literature, cited in `assumptions`.
 * - Epistemic classes: MEAS (directly measured by a named instrument),
 *   DER (deterministically derived from MEAS inputs), INF (inferred from
 *   analogy/curated judgement), UNK (not assessable with available data).
 * - An indicator is NEVER labelled a confirmed discovery unless its evidence
 *   chain is entirely MEAS. Inferred features are reported as "INDICATED" or
 *   "NOT ASSESSED", never "CONFIRMED".
 * - Missing inputs yield UNK indicators with an explicit reason — no zeros, no
 *   placeholder values.
 *
 * Assumption sources (documented, not invented):
 *  A1. Permafrost: continuous permafrost is defined where mean annual ground
 *      temperature < 0 °C (Brown et al., 2002 — NSIDC GGD318 ATBD). Air
 *      temperature is used as proxy with a stated +2 °C ground/air offset
 *      assumption.
 *  A2. Surface water: annual precipitation < 50 mm/yr defines hyper-arid
 *      conditions (UNEP aridity index convention; NASA POWER PRECTOTCORR).
 *  A3. Soil wetness: MERRA-2 GWETTOP/GWETROOT are volumetric-fraction-like
 *      indices 0–1 (NASA POWER documentation).
 *  A4. Water stability: liquid water is transiently possible where diurnal
 *      maxima exceed 0 °C and annual mean > -40 °C (brine eutectic floor;
 *      standard physical-chemistry bounds, e.g. Möhlmann 2004 regime framing).
 *  A5. Lava-tube/cavity evidence: volcanic lithology (Macrostrat) is a
 *      NECESSARY but not SUFFICIENT indicator; presence claims remain INF.
 *  A6. Shielding: regolith mass attenuation ~ factor-of-2 dose reduction per
 *      ~0.5 m of soil (MSL RAD in-regolith context, Hassler et al. 2014);
 *      used only as an order-of-magnitude statement, never a dose number.
 */
(function (root) {
  'use strict';

  const SCHEMA_VERSION = 'astroloc-d4-analysis-v1';

  const EPISTEMIC = Object.freeze({
    MEAS: 'MEAS',
    DER: 'DER',
    INF: 'INF',
    UNK: 'UNK'
  });

  const CLAIM = Object.freeze({
    CONFIRMED_MEASURED: 'CONFIRMED_MEASURED',   // full MEAS chain only
    INDICATED: 'INDICATED',                     // DER/INF evidence, not a discovery
    NOT_ASSESSED: 'NOT_ASSESSED',               // UNK
    ABSENT_EVIDENCE: 'ABSENT_EVIDENCE'          // MEAS evidence of absence
  });

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  function findMeasurement(context, providerId, keyPrefix) {
    if (!context || !Array.isArray(context.providers)) return null;
    const provider = context.providers.find(p => p.providerId === providerId);
    if (!provider) return null;
    return provider.measurements.find(m => m.key === keyPrefix || m.key.startsWith(keyPrefix)) || null;
  }

  function collectMeasurements(context, providerId, keyPrefix) {
    if (!context || !Array.isArray(context.providers)) return [];
    const provider = context.providers.find(p => p.providerId === providerId);
    if (!provider) return [];
    return provider.measurements.filter(m => m.key === keyPrefix || m.key.startsWith(keyPrefix));
  }

  function numOrNull(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function provenanceFrom(measurement, fallbackSource) {
    if (!measurement) {
      return {
        dataset: null,
        instrument: null,
        timestamp: null,
        spatialResolution: null,
        source: fallbackSource || null
      };
    }
    return {
      dataset: measurement.source || null,
      instrument: measurement.instrument || null,
      timestamp: measurement.timestamp || null,
      spatialResolution: measurement.spatialResolution || null,
      source: measurement.source || fallbackSource || null
    };
  }

  /**
   * Standard indicator factory. Every indicator in every category uses this
   * shape, guaranteeing epistemic tagging, provenance, uncertainty and claim
   * classification are always present and always honest.
   */
  function indicator(key, label, {
    value = null,
    unit = '',
    epistemic = EPISTEMIC.UNK,
    claim = CLAIM.NOT_ASSESSED,
    basis = null,            // human-readable derivation description
    inputs = [],             // measurement keys consumed
    provenance = null,
    uncertainty = null,      // explanation of uncertainty
    spatialLimitation = null,
    assumptions = [],        // documented assumption IDs / text
    note = null
  }) {
    return {
      key, label,
      value: value === undefined ? null : value,
      unit: unit || '',
      epistemic,
      claim,
      basis,
      inputs,
      provenance,
      uncertainty,
      spatialLimitation,
      assumptions,
      note
    };
  }

  function category(key, label, indicators, summary) {
    const present = indicators.filter(i => i.epistemic !== EPISTEMIC.UNK);
    const best = present.reduce((acc, i) => {
      const rank = { MEAS: 3, DER: 2, INF: 1, UNK: 0 };
      return (rank[i.epistemic] || 0) > (rank[acc] || 0) ? i.epistemic : acc;
    }, 'UNK');
    return {
      key, label,
      indicators,
      bestEpistemic: best,
      assessed: present.length,
      total: indicators.length,
      summary: summary || null
    };
  }


  // ===========================================================================
  // CATEGORY 1 — Surface water availability (Earth)
  // Inputs: NASA POWER PRECTOTCORR (MEAS), GWETTOP / GWETROOT (MEAS)
  // ===========================================================================
  function analyseSurfaceWater(context) {
    const precipM = findMeasurement(context, 'power_hydro', 'precip_annual');
    const gwetTopM = findMeasurement(context, 'power_hydro', 'soil_wetness_surface');
    const gwetRootM = findMeasurement(context, 'power_hydro', 'soil_wetness_root');

    const precip = precipM ? numOrNull(precipM.value) : null;
    const gwetTop = gwetTopM ? numOrNull(gwetTopM.value) : null;
    const gwetRoot = gwetRootM ? numOrNull(gwetRootM.value) : null;

    const indicators = [];

    if (precip !== null) {
      indicators.push(indicator('annual_precipitation', 'Annual Precipitation', {
        value: precip, unit: 'mm/yr',
        epistemic: EPISTEMIC.MEAS, claim: CLAIM.CONFIRMED_MEASURED,
        basis: 'NASA POWER MERRA-2 PRECTOTCORR annual climatology, daily rate x 365.',
        inputs: ['power_hydro:precip_annual'],
        provenance: provenanceFrom(precipM),
        uncertainty: 'MERRA-2 is a reanalysis on a ~50 km grid; orographic and convective precipitation at a field site can differ by tens of percent from the grid-cell mean.',
        spatialLimitation: '0.5 x 0.625 deg (~50 km) cell - does not resolve valleys, rain shadows or single catchments.',
        assumptions: ['A2']
      }));
    } else {
      indicators.push(indicator('annual_precipitation', 'Annual Precipitation', {
        value: null, unit: 'mm/yr',
        epistemic: EPISTEMIC.UNK, claim: CLAIM.NOT_ASSESSED,
        basis: 'NASA POWER precipitation unavailable for this point.',
        inputs: ['power_hydro:precip_annual'],
        uncertainty: 'Provider returned no valid PRECTOTCORR value.',
        spatialLimitation: 'Unknown - no data.', assumptions: ['A2']
      }));
    }

    if (precip !== null) {
      const label = precip < 50 ? 'hyper-arid (<50 mm/yr)'
        : precip < 200 ? 'arid (50-200 mm/yr)'
        : precip < 500 ? 'semi-arid (200-500 mm/yr)'
        : 'sub-humid/humid (>=500 mm/yr)';
      indicators.push(indicator('aridity_class', 'Aridity Classification', {
        value: label, unit: 'class',
        epistemic: EPISTEMIC.DER, claim: CLAIM.INDICATED,
        basis: 'Threshold classification of measured annual precipitation using UNEP aridity-band conventions.',
        inputs: ['power_hydro:precip_annual'],
        provenance: provenanceFrom(precipM),
        uncertainty: 'Class boundaries are conventional, not physical; a cell straddling a boundary is ambiguously classified.',
        spatialLimitation: 'Inherits the ~50 km reanalysis cell limitation.',
        assumptions: ['A2'],
        note: 'INDICATED: the underlying precipitation is measured, but the class label is a conventional threshold band, not a measurement.'
      }));
    } else {
      indicators.push(indicator('aridity_class', 'Aridity Classification', {
        value: null, unit: 'class',
        epistemic: EPISTEMIC.UNK, claim: CLAIM.NOT_ASSESSED,
        basis: 'Cannot classify without measured precipitation.',
        inputs: ['power_hydro:precip_annual'],
        uncertainty: 'Requires PRECTOTCORR.', spatialLimitation: 'Unknown.', assumptions: ['A2']
      }));
    }

    if (gwetTop !== null) {
      indicators.push(indicator('surface_soil_wetness', 'Surface Soil Wetness', {
        value: gwetTop, unit: 'fraction 0-1',
        epistemic: EPISTEMIC.MEAS, claim: CLAIM.CONFIRMED_MEASURED,
        basis: 'MERRA-2 GWETTOP annual climatological mean (volumetric wetness index).',
        inputs: ['power_hydro:soil_wetness_surface'],
        provenance: provenanceFrom(gwetTopM),
        uncertainty: 'Reanalysis soil moisture is model-assimilated, not remotely sensed at the surface; groundwater is not represented in this variable.',
        spatialLimitation: '~50 km cell; a single spring or seep is far below resolution.',
        assumptions: ['A3']
      }));
    } else {
      indicators.push(indicator('surface_soil_wetness', 'Surface Soil Wetness', {
        value: null, unit: 'fraction 0-1',
        epistemic: EPISTEMIC.UNK, claim: CLAIM.NOT_ASSESSED,
        basis: 'GWETTOP unavailable for this point.',
        inputs: ['power_hydro:soil_wetness_surface'],
        uncertainty: 'No valid GWETTOP value returned.', spatialLimitation: 'Unknown.', assumptions: ['A3']
      }));
    }

    if (gwetRoot !== null) {
      indicators.push(indicator('rootzone_soil_wetness', 'Root-Zone Soil Wetness', {
        value: gwetRoot, unit: 'fraction 0-1',
        epistemic: EPISTEMIC.MEAS, claim: CLAIM.CONFIRMED_MEASURED,
        basis: 'MERRA-2 GWETROOT annual climatological mean over the root-zone layer.',
        inputs: ['power_hydro:soil_wetness_root'],
        provenance: provenanceFrom(gwetRootM),
        uncertainty: 'Model layer depth (root zone) is fixed by MERRA-2, not local stratigraphy; deep aquifers are not represented.',
        spatialLimitation: '~50 km cell; cannot distinguish perched water from a regional aquifer.',
        assumptions: ['A3']
      }));
    } else {
      indicators.push(indicator('rootzone_soil_wetness', 'Root-Zone Soil Wetness', {
        value: null, unit: 'fraction 0-1',
        epistemic: EPISTEMIC.UNK, claim: CLAIM.NOT_ASSESSED,
        basis: 'GWETROOT unavailable for this point.',
        inputs: ['power_hydro:soil_wetness_root'],
        uncertainty: 'No valid GWETROOT value returned.', spatialLimitation: 'Unknown.', assumptions: ['A3']
      }));
    }

    const assessed = indicators.filter(i => i.epistemic !== EPISTEMIC.UNK).length;
    return category('surface_water', 'Surface Water Availability', indicators,
      assessed ? `${assessed}/${indicators.length} surface-water indicators resolved from measured reanalysis fields.`
        : 'No surface-water indicators could be resolved for this point.');
  }

  // ===========================================================================
  // CATEGORY 2 — Ice and permafrost indicators (Earth)
  // Inputs: NASA POWER T2M-derived telemetry (MEAS) + NSIDC static reference
  // ===========================================================================
  function analyseIcePermafrost(context, telemetry) {
    const indicators = [];
    const tempMean = numOrNull(telemetry && telemetry.tempMean);
    const ggd = findMeasurement(context, 'nsidc_static', 'ggd318_reference');

    if (tempMean !== null) {
      indicators.push(indicator('mean_annual_air_temperature', 'Mean Annual Air Temperature', {
        value: tempMean, unit: 'deg C',
        epistemic: EPISTEMIC.MEAS, claim: CLAIM.CONFIRMED_MEASURED,
        basis: 'NASA POWER T2M annual climatology from the existing AstroLoc telemetry pipeline.',
        inputs: ['telemetry:tempMean'],
        provenance: {
          dataset: 'NASA POWER MERRA-2 Climatology',
          instrument: 'MERRA-2 reanalysis (2 m air temperature)',
          timestamp: '1991-2020 climatology',
          spatialResolution: '0.5 x 0.625 deg (~50 km)',
          source: 'NASA POWER'
        },
        uncertainty: '2 m air temperature is not ground temperature; snow cover, aspect and substrate strongly modulate the offset.',
        spatialLimitation: '~50 km cell mean - cold-air pooling in valleys is unresolved.',
        assumptions: ['A1']
      }));
    } else {
      indicators.push(indicator('mean_annual_air_temperature', 'Mean Annual Air Temperature', {
        value: null, unit: 'deg C',
        epistemic: EPISTEMIC.UNK, claim: CLAIM.NOT_ASSESSED,
        basis: 'Telemetry did not resolve T2M for this point.',
        inputs: ['telemetry:tempMean'],
        uncertainty: 'No measured air temperature available.', spatialLimitation: 'Unknown.', assumptions: ['A1']
      }));
    }

    if (tempMean !== null) {
      // A1: MAGT < 0 deg C defines permafrost; assume ground ~= air + 2 deg C.
      const magtProxy = Number((tempMean + 2).toFixed(1));
      const likelyPermafrost = magtProxy < 0;
      indicators.push(indicator('permafrost_thermal_likelihood', 'Permafrost Thermal Likelihood', {
        value: likelyPermafrost ? 'thermally possible' : 'thermally unlikely',
        unit: 'class',
        epistemic: EPISTEMIC.DER, claim: CLAIM.INDICATED,
        basis: `Mean annual ground temperature proxy (air + 2 deg C assumed offset) = ${magtProxy} deg C; permafrost requires ground temperature < 0 deg C.`,
        inputs: ['telemetry:tempMean', 'nsidc_static:ggd318_reference'],
        provenance: {
          dataset: 'NASA POWER MERRA-2 + NSIDC GGD318 reference',
          instrument: 'MERRA-2 reanalysis; NSIDC compiled permafrost map',
          timestamp: '1991-2020 climatology; static GGD318 map',
          spatialResolution: '~50 km cell; GGD318 ~1:10M',
          source: 'NASA POWER / NSIDC'
        },
        uncertainty: 'The +2 deg C air-to-ground offset is an assumption, not a measurement at this site. Local snow depth and organic layer can shift the true offset by 2-3 deg C, which decides the sign near 0 deg C.',
        spatialLimitation: 'A thermal proxy cannot confirm permafrost at a specific outcrop; GGD318 is a regional map, not a site survey.',
        assumptions: ['A1'],
        note: 'INDICATED only. Thermal possibility is not a permafrost confirmation; an in-situ ground-temperature log or borehole is required for MEAS.'
      }));
    } else {
      indicators.push(indicator('permafrost_thermal_likelihood', 'Permafrost Thermal Likelihood', {
        value: null, unit: 'class',
        epistemic: EPISTEMIC.UNK, claim: CLAIM.NOT_ASSESSED,
        basis: 'Requires mean annual air temperature.',
        inputs: ['telemetry:tempMean'],
        uncertainty: 'No temperature input.', spatialLimitation: 'Unknown.', assumptions: ['A1']
      }));
    }

    if (ggd) {
      indicators.push(indicator('glacier_permafrost_reference_layers', 'Glacier & Permafrost Reference Layers', {
        value: 'reference layers available (RGI v7, GGD318)',
        unit: 'flag',
        epistemic: EPISTEMIC.INF, claim: CLAIM.INDICATED,
        basis: 'NSIDC RGI v7 and GGD318 are registered as available reference datasets for this analysis.',
        inputs: ['nsidc_static:rgi_v7_reference', 'nsidc_static:ggd318_reference'],
        provenance: {
          dataset: 'NSIDC RGI v7 (NSIDC-0770) + GGD318 permafrost map',
          instrument: 'Landsat/SPOT glacier outlines; compiled permafrost map',
          timestamp: 'RGI 1950-2021 outlines; GGD318 static map',
          spatialResolution: 'RGI varies; GGD318 ~1:10M',
          source: 'NSIDC DAAC'
        },
        uncertainty: 'These layers are NOT spatially intersected with the site in this engine. Their availability does not establish ice presence at the coordinate.',
        spatialLimitation: 'No point-in-polygon test is performed - polygon conversion is outstanding (see Phase 2 limitations).',
        assumptions: [],
        note: 'Reported as available reference data only. No ice-presence claim is made.'
      }));
    }

    const assessed = indicators.filter(i => i.epistemic !== EPISTEMIC.UNK).length;
    return category('ice_permafrost', 'Ice & Permafrost Indicators', indicators,
      assessed ? `${assessed}/${indicators.length} cryosphere indicators resolved; permafrost status remains INDICATED at best.`
        : 'No cryosphere indicators could be resolved.');
  }

  // ===========================================================================
  // CATEGORY 3 — Subsurface ice potential (Mars / Moon)
  // Mars: SHARAD radar-sounder bundles (registered, not sample-level accessible)
  // Moon: Diviner / Mini-RF verified UNAVAILABLE in Phase 2
  // ===========================================================================
  function analyseSubsurfaceIce(context, body) {
    const indicators = [];
    const sharad = collectMeasurements(context, 'pds_sharad', 'sharad_bundle');
    const unavailable = context && Array.isArray(context.providers)
      ? context.providers.find(p => p.providerId === 'diviner_minirf_themis')
      : null;

    if (body === 'Mars' && sharad.length) {
      indicators.push(indicator('sharad_instrument_coverage', 'SHARAD Subsurface Radar Coverage', {
        value: `${sharad.length} PDS bundle(s) registered`,
        unit: 'count',
        epistemic: EPISTEMIC.MEAS, claim: CLAIM.CONFIRMED_MEASURED,
        basis: 'NASA PDS Search API confirms SHARAD radargram bundles exist in the archive for this body.',
        inputs: sharad.map(m => `pds_sharad:${m.key}`),
        provenance: provenanceFrom(sharad[0]),
        uncertainty: 'Bundle existence confirms the instrument dataset is archived; it does NOT confirm coverage of this specific coordinate, nor the presence of ice.',
        spatialLimitation: 'SHARAD ground tracks are ~0.3-1 km wide swaths, not a continuous grid; a coordinate may fall between tracks.',
        assumptions: [],
        note: 'Archive-level evidence only. No radargram sample values were retrieved (no REST API exposes them).'
      }));

      indicators.push(indicator('subsurface_ice_presence', 'Subsurface Water-Ice Presence', {
        value: null, unit: 'flag',
        epistemic: EPISTEMIC.UNK, claim: CLAIM.NOT_ASSESSED,
        basis: 'SHARAD detects subsurface interfaces, but radargram interpretation requires expert clutter analysis that this engine does not perform.',
        inputs: ['pds_sharad:sharad_bundle'],
        provenance: provenanceFrom(sharad[0]),
        uncertainty: 'Reflector detection in SHARAD requires discriminating real basal echoes from off-nadir surface clutter; automated point queries are not published.',
        spatialLimitation: 'Along-track swaths only; no global ice-depth product exists.',
        assumptions: [],
        note: 'Deliberately NOT inferred. Claiming ice presence from bundle metadata alone would be fabrication.'
      }));
    } else if (body === 'Mars') {
      indicators.push(indicator('subsurface_ice_presence', 'Subsurface Water-Ice Presence', {
        value: null, unit: 'flag',
        epistemic: EPISTEMIC.UNK, claim: CLAIM.NOT_ASSESSED,
        basis: 'SHARAD bundle metadata could not be retrieved from NASA PDS.',
        inputs: ['pds_sharad:sharad_bundle'],
        uncertainty: 'Provider unavailable.', spatialLimitation: 'Unknown.', assumptions: []
      }));
    }

    if (body === 'Moon') {
      indicators.push(indicator('lunar_polar_ice', 'Lunar Subsurface / Polar Ice', {
        value: null, unit: 'flag',
        epistemic: EPISTEMIC.UNK, claim: CLAIM.NOT_ASSESSED,
        basis: 'LRO Mini-RF CPR and Diviner cold-trap products have no verified point-access API (Phase 2: PDS instrument LIDs returned 0 hits, trek WMTS returned 404).',
        inputs: ['diviner_minirf_themis'],
        provenance: {
          dataset: 'LRO Diviner / Mini-RF (bulk PDS archives)',
          instrument: 'Diviner radiometer; Mini-RF radar',
          timestamp: null,
          spatialResolution: 'Diviner 200-320 m; Mini-RF ~15 m',
          source: 'NASA PDS (bulk only)'
        },
        uncertainty: 'No point-queryable product verified. Bulk radar and temperature grids would need offline ingestion.',
        spatialLimitation: 'Not assessable in-browser.',
        assumptions: [],
        note: unavailable && unavailable.meta && unavailable.meta.error ? unavailable.meta.error : null
      }));
    }

    const assessed = indicators.filter(i => i.epistemic !== EPISTEMIC.UNK).length;
    return category('subsurface_ice', 'Subsurface Ice Potential', indicators,
      assessed ? `${assessed}/${indicators.length} subsurface-ice indicators resolved. Ice presence itself remains NOT ASSESSED.`
        : 'Subsurface ice could not be assessed with point-queryable data.');
  }

  // ===========================================================================
  // CATEGORY 4 — Underground cavities and lava tube evidence (Earth / Mars)
  // Earth: Macrostrat lithology (MEAS) -> volcanic rock presence (DER)
  // Mars: SHARAD archive (MEAS of archive, not of cavities)
  // ===========================================================================
  function analyseCavities(context, body) {
    const indicators = [];
    const units = collectMeasurements(context, 'macrostrat_subsurface', 'subsurface_unit_');
    const sharad = collectMeasurements(context, 'pds_sharad', 'sharad_bundle');

    if (body === 'Earth') {
      if (units.length) {
        const blob = units.map(u => String(u.value || '')).join(' ').toLowerCase();
        const volcanic = /basalt|volcanic|andesite|dacite|rhyolite|tuff|scoria|ignimbrite/.test(blob);
        const first = units[0];
        indicators.push(indicator('volcanic_lithology', 'Volcanic Lithology (lava-tube prerequisite)', {
          value: volcanic ? 'volcanic rocks present' : 'no volcanic lithology in mapped units',
          unit: 'class',
          epistemic: EPISTEMIC.DER, claim: CLAIM.INDICATED,
          basis: 'Keyword classification of Macrostrat mapped lithologies for basaltic/volcanic rock types.',
          inputs: units.map(u => `macrostrat_subsurface:${u.key}`),
          provenance: provenanceFrom(first),
          uncertainty: 'Lithology is mapped at 1:24k-1:1M scale; unmapped volcanic dikes or buried flows below the map unit are invisible. Keyword matching can also miss synonyms.',
          spatialLimitation: 'Map-unit scale only - a lava tube inside a mapped unit is not resolved.',
          assumptions: ['A5'],
          note: volcanic
            ? 'INDICATED: volcanic terrain is a necessary precondition for lava tubes, not proof of a tube.'
            : 'No volcanic lithology mapped here; lava tubes are unlikely but small unmapped bodies cannot be excluded.'
        }));
      } else {
        indicators.push(indicator('volcanic_lithology', 'Volcanic Lithology (lava-tube prerequisite)', {
          value: null, unit: 'class',
          epistemic: EPISTEMIC.UNK, claim: CLAIM.NOT_ASSESSED,
          basis: 'Macrostrat returned no mapped units for this point.',
          inputs: ['macrostrat_subsurface:subsurface_unit_*'],
          uncertainty: 'No lithology data.', spatialLimitation: 'Unknown.', assumptions: ['A5']
        }));
      }

      indicators.push(indicator('cavity_presence', 'Cavity / Lava Tube Presence', {
        value: null, unit: 'flag',
        epistemic: EPISTEMIC.UNK, claim: CLAIM.NOT_ASSESSED,
        basis: 'No point-queryable cave inventory is integrated. Cave databases (e.g. national speleological registries) are not accessible via a verified API in this project.',
        inputs: [],
        uncertainty: 'Cavity detection requires LiDAR, GPR or field survey; none are point-queryable here.',
        spatialLimitation: 'Not assessable in-browser.',
        assumptions: ['A5'],
        note: 'Deliberately NOT inferred from lithology alone.'
      }));
    }

    if (body === 'Mars' && sharad.length) {
      indicators.push(indicator('mars_cavity_evidence_status', 'Mars Cavity Evidence Status', {
        value: 'SHARAD archive registered; no cavity product queryable',
        unit: 'flag',
        epistemic: EPISTEMIC.INF, claim: CLAIM.INDICATED,
        basis: 'Candidate lava-tube skylights on Mars are catalogued from HiRISE imagery in the literature, but no point API exposes those catalogues.',
        inputs: ['pds_sharad:sharad_bundle'],
        provenance: provenanceFrom(sharad[0]),
        uncertainty: 'Skylight catalogues are curated lists, not measurement services; integrating them would require offline ingestion.',
        spatialLimitation: 'Not assessable in-browser.',
        assumptions: ['A5'],
        note: 'Reported as data-availability status only. No cavity is claimed at this coordinate.'
      }));
    }

    const assessed = indicators.filter(i => i.epistemic !== EPISTEMIC.UNK).length;
    return category('cavities_lava_tubes', 'Underground Cavities & Lava Tube Evidence', indicators,
      assessed ? `${assessed}/${indicators.length} cavity indicators resolved; cavity presence itself remains NOT ASSESSED.`
        : 'Cavity evidence could not be assessed with point-queryable data.');
  }

  // ===========================================================================
  // CATEGORY 5 — Geological shielding and subsurface shelter
  // Uses site.shieldingDepth (curated operator value) + lithology as overburden
  // proxy. Explicitly separates CURATED from MEASURED.
  // ===========================================================================
  function analyseShielding(context, site) {
    const indicators = [];
    const depth = numOrNull(site && site.shieldingDepth);
    const units = collectMeasurements(context, 'macrostrat_subsurface', 'subsurface_unit_');
    const depthTag = site && site.epistemicTags ? site.epistemicTags.shieldingDepth : null;

    if (depth !== null) {
      const tier = depth >= 10 ? 'high overburden (>=10 m)' : depth >= 3 ? 'moderate overburden (3-10 m)' : 'thin overburden (<3 m)';
      // Conservative default: only treat as MEAS when the site explicitly tags
      // the depth as measured. An absent/unknown tag is treated as curated.
      const curated = depthTag !== 'measured' && depthTag !== 'MEAS';
      indicators.push(indicator('overburden_depth', 'Overburden Shielding Depth', {
        value: depth, unit: 'm',
        epistemic: curated ? EPISTEMIC.INF : EPISTEMIC.MEAS,
        claim: curated ? CLAIM.INDICATED : CLAIM.CONFIRMED_MEASURED,
        basis: `Curated site value classified into an overburden tier: ${tier}.`,
        inputs: ['site:shieldingDepth'],
        provenance: {
          dataset: 'AstroLoc curated site record',
          instrument: curated ? 'Literature/field survey synthesis' : 'Field measurement',
          timestamp: null,
          spatialResolution: 'Site-level point value',
          source: 'AstroLoc analog database'
        },
        uncertainty: 'A single depth value cannot represent a heterogeneous roof; lateral thickness variation and fractures dominate real shielding.',
        spatialLimitation: 'Site-level scalar - no spatial extent or geometry.',
        assumptions: ['A6'],
        note: curated
          ? 'INDICATED: value originates from curated literature synthesis, not an in-situ measurement at this coordinate.'
          : 'Measured depth supplied by the operator.'
      }));

      indicators.push(indicator('shielding_tier', 'Radiation Shielding Tier', {
        value: tier, unit: 'class',
        epistemic: EPISTEMIC.DER, claim: CLAIM.INDICATED,
        basis: 'Order-of-magnitude tiering of overburden depth using the ~0.5 m halving-length convention for regolith/soil.',
        inputs: ['site:shieldingDepth'],
        provenance: {
          dataset: 'AstroLoc curated site record + published attenuation convention',
          instrument: null, timestamp: null,
          spatialResolution: 'Site-level', source: 'AstroLoc / literature'
        },
        uncertainty: 'Dose attenuation depends on material density, composition and secondary neutron production; a depth tier is not a dose rate. No mSv/yr value is claimed.',
        spatialLimitation: 'Site-level scalar.',
        assumptions: ['A6'],
        note: 'No radiation dose is computed or asserted anywhere in this engine.'
      }));
    } else {
      indicators.push(indicator('overburden_depth', 'Overburden Shielding Depth', {
        value: null, unit: 'm',
        epistemic: EPISTEMIC.UNK, claim: CLAIM.NOT_ASSESSED,
        basis: 'No shielding depth recorded for this site.',
        inputs: ['site:shieldingDepth'],
        uncertainty: 'No value supplied.', spatialLimitation: 'Unknown.', assumptions: ['A6']
      }));
    }

    if (units.length) {
      const blob = units.map(u => String(u.value || '')).join(' ').toLowerCase();
      const competent = /limestone|carbonate|basalt|granite|sandstone|dolomite/.test(blob);
      indicators.push(indicator('overburden_competence', 'Overburden Rock Competence (roof stability proxy)', {
        value: competent ? 'competent lithologies mapped' : 'no competent lithology in mapped units',
        unit: 'class',
        epistemic: EPISTEMIC.INF, claim: CLAIM.INDICATED,
        basis: 'Keyword screening of mapped lithologies for rock types generally capable of spanning a cavity roof.',
        inputs: units.map(u => `macrostrat_subsurface:${u.key}`),
        provenance: provenanceFrom(units[0]),
        uncertainty: 'Competence depends on fracture density, alteration and in-situ stress - none of which are in a map polygon. This is a weak inference.',
        spatialLimitation: 'Map-unit scale.',
        assumptions: ['A5', 'A6'],
        note: 'INDICATED only - not a roof-stability assessment or engineering conclusion.'
      }));
    }

    const assessed = indicators.filter(i => i.epistemic !== EPISTEMIC.UNK).length;
    return category('shielding_shelter', 'Geological Shielding & Subsurface Shelter', indicators,
      assessed ? `${assessed}/${indicators.length} shelter indicators resolved; shielding class is INDICATED, not measured dosimetry.`
        : 'Shelter indicators could not be resolved.');
  }

  // ===========================================================================
  // CATEGORY 6 — Water stability and thermal conditions
  // Inputs: telemetry tempMean / tempMax / diurnalDelta (MEAS)
  // ===========================================================================
  function analyseWaterStability(context, telemetry) {
    const indicators = [];
    const tMean = numOrNull(telemetry && telemetry.tempMean);
    const tMax = numOrNull(telemetry && telemetry.tempMax);
    const diurnal = numOrNull(telemetry && telemetry.diurnalDelta);
    const powerProv = {
      dataset: 'NASA POWER MERRA-2 Climatology',
      instrument: 'MERRA-2 reanalysis (2 m air temperature)',
      timestamp: '1991-2020 climatology',
      spatialResolution: '0.5 x 0.625 deg (~50 km)',
      source: 'NASA POWER'
    };

    if (tMean !== null) {
      indicators.push(indicator('mean_annual_temperature', 'Mean Annual Temperature', {
        value: tMean, unit: 'deg C',
        epistemic: EPISTEMIC.MEAS, claim: CLAIM.CONFIRMED_MEASURED,
        basis: 'NASA POWER T2M annual climatology via the existing telemetry pipeline.',
        inputs: ['telemetry:tempMean'],
        provenance: powerProv,
        uncertainty: 'Grid-cell annual mean smooths the diurnal and seasonal extremes that govern transient liquid water.',
        spatialLimitation: '~50 km cell.',
        assumptions: ['A4']
      }));
    } else {
      indicators.push(indicator('mean_annual_temperature', 'Mean Annual Temperature', {
        value: null, unit: 'deg C',
        epistemic: EPISTEMIC.UNK, claim: CLAIM.NOT_ASSESSED,
        basis: 'Telemetry did not resolve T2M.', inputs: ['telemetry:tempMean'],
        uncertainty: 'No temperature input.', spatialLimitation: 'Unknown.', assumptions: ['A4']
      }));
    }

    if (tMean !== null && tMax !== null) {
      const tooCold = tMean < -40;
      const thawPossible = tMax > 0;
      const regime = tooCold
        ? 'persistently frozen (mean < -40 deg C)'
        : thawPossible
          ? 'transient thaw possible (maxima above 0 deg C)'
          : 'frozen (maxima remain below 0 deg C)';
      indicators.push(indicator('liquid_water_stability', 'Liquid Water Stability Regime', {
        value: regime, unit: 'class',
        epistemic: EPISTEMIC.DER, claim: CLAIM.INDICATED,
        basis: 'Air-temperature regime classification using measured annual mean and maximum; liquid water requires maxima above 0 deg C and a mean above the brine eutectic floor.',
        inputs: ['telemetry:tempMean', 'telemetry:tempMax'],
        provenance: powerProv,
        uncertainty: 'Air temperature is not surface or subsurface temperature. Brine chemistry (perchlorate, chloride) can depress the freezing point well below 0 deg C, so this regime describes the unbrined water case only.',
        spatialLimitation: '~50 km cell; microclimate in caves or pole-facing slopes is unresolved.',
        assumptions: ['A4'],
        note: 'INDICATED regime only. Not an observation of liquid water, and carries no habitability claim.'
      }));
    } else {
      indicators.push(indicator('liquid_water_stability', 'Liquid Water Stability Regime', {
        value: null, unit: 'class',
        epistemic: EPISTEMIC.UNK, claim: CLAIM.NOT_ASSESSED,
        basis: 'Requires annual mean and maximum temperature.',
        inputs: ['telemetry:tempMean', 'telemetry:tempMax'],
        uncertainty: 'Insufficient temperature inputs.', spatialLimitation: 'Unknown.', assumptions: ['A4']
      }));
    }

    if (diurnal !== null) {
      indicators.push(indicator('diurnal_thermal_swing', 'Diurnal Thermal Swing', {
        value: diurnal, unit: 'deg C',
        epistemic: EPISTEMIC.MEAS, claim: CLAIM.CONFIRMED_MEASURED,
        basis: 'Measured diurnal temperature range from the telemetry pipeline.',
        inputs: ['telemetry:diurnalDelta'],
        provenance: powerProv,
        uncertainty: 'Grid-cell diurnal range damps true site extremes; radiative cooling in thin air is under-represented at coarse resolution.',
        spatialLimitation: '~50 km cell.',
        assumptions: ['A4']
      }));
    }

    const assessed = indicators.filter(i => i.epistemic !== EPISTEMIC.UNK).length;
    return category('water_stability_thermal', 'Water Stability & Thermal Conditions', indicators,
      assessed ? `${assessed}/${indicators.length} thermal-stability indicators resolved from measured reanalysis fields.`
        : 'Thermal stability could not be resolved.');
  }

  // ===========================================================================
  // Aggregate into the standardized D4 result object
  // ===========================================================================
  const CATEGORY_WEIGHTS = Object.freeze({
    surface_water: 0.20,
    ice_permafrost: 0.18,
    subsurface_ice: 0.17,
    cavities_lava_tubes: 0.15,
    shielding_shelter: 0.15,
    water_stability_thermal: 0.15
  });

  function confidenceFromCategories(categories) {
    let weighted = 0;
    let totalWeight = 0;
    for (const c of categories) {
      const w = CATEGORY_WEIGHTS[c.key] || 0;
      if (w <= 0) continue;
      const ratio = c.total > 0 ? c.assessed / c.total : 0;
      weighted += ratio * w;
      totalWeight += w;
    }
    return totalWeight > 0 ? Math.round((weighted / totalWeight) * 100) : 0;
  }

  function verifyEpistemicHonesty(categories) {
    const violations = [];
    for (const c of categories) {
      for (const i of c.indicators) {
        if (i.claim === CLAIM.CONFIRMED_MEASURED && i.epistemic !== EPISTEMIC.MEAS) {
          violations.push(`${c.key}/${i.key}: claim CONFIRMED_MEASURED with epistemic ${i.epistemic}`);
        }
        if (i.claim === CLAIM.NOT_ASSESSED && i.epistemic !== EPISTEMIC.UNK) {
          violations.push(`${c.key}/${i.key}: claim NOT_ASSESSED but epistemic ${i.epistemic}`);
        }
        if (i.epistemic !== EPISTEMIC.UNK && !i.provenance) {
          violations.push(`${c.key}/${i.key}: missing provenance`);
        }
        if (!i.uncertainty) {
          violations.push(`${c.key}/${i.key}: missing uncertainty statement`);
        }
      }
    }
    return violations;
  }


  /**
   * Main entry point.
   * @param {object} opts
   *   opts.context   - Phase 2 envelope bundle (AstroLocD4Providers.fetchD4Context)
   *   opts.site      - AstroLoc site record (curated fields + epistemicTags)
   *   opts.telemetry - telemetry object from queryFreeEarthTelemetry
   *   opts.body      - 'Earth' | 'Mars' | 'Moon'
   */
  function analyseD4(opts = {}) {
    const context = opts.context || null;
    const site = opts.site || {};
    const telemetry = opts.telemetry || {};
    const body = (opts.body || site.analogBody || site.primaryTarget || 'Earth').toString();
    const normalisedBody = /moon/i.test(body) ? 'Moon' : /mars/i.test(body) ? 'Mars' : 'Earth';

    const categories = [
      analyseSurfaceWater(context),
      analyseIcePermafrost(context, telemetry),
      analyseSubsurfaceIce(context, normalisedBody),
      analyseCavities(context, normalisedBody),
      analyseShielding(context, site),
      analyseWaterStability(context, telemetry)
    ];

    const allIndicators = categories.flatMap(c => c.indicators);
    const assessedIndicators = allIndicators.filter(i => i.epistemic !== EPISTEMIC.UNK);

    const epistemicBreakdown = {
      MEAS: allIndicators.filter(i => i.epistemic === EPISTEMIC.MEAS).length,
      DER: allIndicators.filter(i => i.epistemic === EPISTEMIC.DER).length,
      INF: allIndicators.filter(i => i.epistemic === EPISTEMIC.INF).length,
      UNK: allIndicators.filter(i => i.epistemic === EPISTEMIC.UNK).length
    };

    const confirmedClaims = allIndicators.filter(i => i.claim === CLAIM.CONFIRMED_MEASURED);
    const indicatedClaims = allIndicators.filter(i => i.claim === CLAIM.INDICATED);
    const notAssessedClaims = allIndicators.filter(i => i.claim === CLAIM.NOT_ASSESSED);
    const absentClaims = allIndicators.filter(i => i.claim === CLAIM.ABSENT_EVIDENCE);

    const confidence = confidenceFromCategories(categories);
    const violations = verifyEpistemicHonesty(categories);

    const provenanceDatasets = [];
    for (const i of allIndicators) {
      if (i.provenance && i.provenance.dataset && !provenanceDatasets.includes(i.provenance.dataset)) {
        provenanceDatasets.push(i.provenance.dataset);
      }
    }

    const limitations = [];
    if (normalisedBody === 'Mars') {
      limitations.push('Mars D4: SHARAD radargram sample values are not exposed by any point-query API; only archive-level metadata is verified.');
      limitations.push('Mars D4: candidate lava-tube skylight catalogues (HiRISE) are literature products, not integrated services.');
    }
    if (normalisedBody === 'Moon') {
      limitations.push('Moon D4: Diviner and Mini-RF have no verified point-access API; bulk PDS ingestion is required for thermal/radar indicators.');
    }
    if (normalisedBody === 'Earth') {
      limitations.push('Earth D4: NASA POWER/GWET variables are ~50 km reanalysis cells; site-scale hydrology (springs, seeps, perched aquifers) is below resolution.');
      limitations.push('Earth D4: NSIDC RGI/GGD318 polygons are registered but not spatially intersected in this engine.');
    }
    limitations.push('All bodies: indicator claims are epistemic-classified; INDICATED is not a confirmed discovery.');

    return {
      schemaVersion: SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      body: normalisedBody,
      siteId: site.id || null,
      siteName: site.name || null,
      lat: Number.isFinite(Number(site.lat)) ? Number(site.lat) : (context ? context.lat : null),
      lon: Number.isFinite(Number(site.lon)) ? Number(site.lon) : (context ? context.lon : null),

      categories,
      indicators: allIndicators,

      epistemicBreakdown,
      indicatorCoverage: {
        assessed: assessedIndicators.length,
        total: allIndicators.length,
        percent: allIndicators.length ? Math.round((assessedIndicators.length / allIndicators.length) * 100) : 0
      },
      confidence: {
        value: confidence,
        basis: 'Weighted ratio of assessed-to-total indicators across the six D4 categories.',
        weights: CATEGORY_WEIGHTS
      },
      claims: {
        confirmedMeasured: confirmedClaims.length,
        indicated: indicatedClaims.length,
        absentEvidence: absentClaims.length,
        notAssessed: notAssessedClaims.length,
        discoveryGrade: confirmedClaims.length > 0 && indicatedClaims.every(i => i.epistemic === EPISTEMIC.MEAS)
      },

      provenance: {
        datasets: provenanceDatasets,
        providerContextQueriedAt: context ? context.queriedAt : null,
        providerCount: context && Array.isArray(context.providers) ? context.providers.length : 0
      },
      assumptions: [
        'A1 permafrost thermal definition (ground < 0 deg C; air + 2 deg C proxy) - NSIDC GGD318 ATBD',
        'A2 aridity band conventions - UNEP aridity index',
        'A3 MERRA-2 GWETTOP/GWETROOT as 0-1 wetness indices - NASA POWER docs',
        'A4 liquid-water regime bounds (maxima > 0 deg C, mean > -40 deg C) - standard brine eutectic framing',
        'A5 volcanic/competent lithology as necessary-not-sufficient indicators - Macrostrat map units',
        'A6 ~0.5 m dose-halving convention used strictly for order-of-magnitude tiering'
      ],
      limitations,
      integrity: {
        violations,
        passed: violations.length === 0
      }
    };
  }


  /**
   * Compatibility projection for the AstroLoc discovery engine. The discovery
   * scan consumes plain site fields, so this exposes D4 results in that shape
   * WITHOUT touching or overriding existing D4 score inputs
   * (lavaTubeScore / iceCaveScore / shieldingDepth).
   */
  function toDiscoveryFields(d4Result) {
    if (!d4Result) return null;
    return {
      d4SchemaVersion: d4Result.schemaVersion,
      d4Confidence: d4Result.confidence.value,
      d4CoveragePercent: d4Result.indicatorCoverage.percent,
      d4Epistemic: d4Result.epistemicBreakdown,
      d4Claims: d4Result.claims,
      d4Limitations: d4Result.limitations,
      d4ProvenanceDatasets: d4Result.provenance.datasets,
      d4Categories: d4Result.categories.map(c => ({
        key: c.key,
        label: c.label,
        assessed: c.assessed,
        total: c.total,
        bestEpistemic: c.bestEpistemic,
        summary: c.summary
      }))
    };
  }

  const D4_ANALYSIS = Object.freeze({
    SCHEMA_VERSION,
    EPISTEMIC,
    CLAIM,
    CATEGORY_WEIGHTS,
    analyseD4,
    toDiscoveryFields,
    analyseSurfaceWater,
    analyseIcePermafrost,
    analyseSubsurfaceIce,
    analyseCavities,
    analyseShielding,
    analyseWaterStability
  });

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = D4_ANALYSIS;
  }
  root.AstroLocD4Analysis = D4_ANALYSIS;
})(typeof window !== 'undefined' ? window : globalThis);
