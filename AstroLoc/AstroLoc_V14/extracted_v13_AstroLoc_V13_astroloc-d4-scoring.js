/**
 * astroloc-d4-scoring.js
 * AstroLoc Phase 4 — D4 scoring layer (Phase 2 Targeted Scientific Audit Fix).
 *
 * Separates four distinct quantities that must never be conflated:
 *
 *   environmentalSimilarity      — how well the site matches the target body's
 *                                  subsurface/cryosphere regime (0–100). Feeds the
 *                                  overall 5D analog similarity score.
 *   settlementShelterSuitability — operational radiation overburden & thermal shelter
 *                                  suitability for human base infrastructure (0–100).
 *                                  Explicitly separated from environmentalSimilarity.
 *   evidenceQuality              — how well-supported the evaluation is (0–100),
 *                                  from the epistemic mix (MEAS/DER/INF/UNK).
 *   coverage                     — fraction of applicable D4 sub-metrics present.
 *
 * Design rules:
 *  - Independent Mars vs. Moon weighting and indicator applicability:
 *      * Lunar environments are vacuum-anhydrous (no meteoric aridity regime and
 *        no glaciokarst permafrost caves). Surface aridity and permafrost are
 *        excluded (weight 0 / null) when scoring against the Moon.
 *  - Reuses ONLY the bounded transforms already documented and in use in the
 *    existing AstroLoc engine (depth-vs-target, temperature-vs-target).
 *  - An INF indicator can never be promoted to a measured observation: its
 *    similarity contribution is damped (<= 0.25) AND it is flagged unsupported.
 *  - Missing or structurally unassessable measurements reduce coverage of assessed
 *    metrics; they never silently score 0.
 */
(function (root) {
  'use strict';

  const SCORING_VERSION = 'astroloc-d4-scoring-v2';

  // Epistemic confidence factors. Mirrors EPISTEMIC_WEIGHTS in the main app so
  // D4 evidence quality is on the same scale as D1/D2/D3/D5.
  const EPISTEMIC_FACTOR = Object.freeze({
    MEAS: 1.0,
    DER: 0.82,
    INF: 0.58,
    UNK: 0.0
  });

  /**
   * Similarity credit allowed per epistemic class. Inferred indicators are
   * deliberately suppressed: they may inform, but they must not drive a score
   * as if they were observed.
   */
  const SIMILARITY_CREDIT = Object.freeze({
    MEAS: 1.0,
    DER: 0.6,
    INF: 0.25,
    UNK: 0.0
  });

  function clamp(v, lo, hi) {
    return Math.min(hi, Math.max(lo, v));
  }

  function numOrNull(v) {
    if (v === null || v === undefined || typeof v === 'boolean' || String(v).trim() === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function findIndicator(analysis, categoryKey, indicatorKey) {
    if (!analysis || !Array.isArray(analysis.categories)) return null;
    const cat = analysis.categories.find(c => c.key === categoryKey);
    if (!cat) return null;
    return cat.indicators.find(i => i.key === indicatorKey) || null;
  }

  /**
   * Depth-vs-target transform. Documented and already in use in the existing
   * AstroLoc D4 block: full credit at/above the target, linear decay to a floor
   * of 15 below it.
   */
  function scoreDepthAgainstTarget(depth, target) {
    if (depth === null || target === null || target <= 0) return null;
    if (depth >= target) return 100;
    return clamp(Math.round(100 - ((target - depth) / Math.max(1, target)) * 65), 15, 100);
  }

  /**
   * Temperature-regime transform. Documented in the existing engine as an
   * absolute-difference penalty against the target mean. Aligned to 1.1/deg C
   * (matching D3 thermal mean penalty) so terrestrial temperatures (-55 C to +25 C)
   * do not artificially floor against Mars (-63 C) or Moon (-53 C).
   */
  function scoreTempAgainstTarget(temp, target, perDegreePenalty) {
    if (temp === null || target === null) return null;
    return clamp(Math.round(100 - Math.abs(temp - target) * (perDegreePenalty || 1.1)), 10, 100);
  }

  /**
   * Builds the D4 sub-metric list from a Phase 3 analysis result.
   * Distinguishes Mars vs. Moon target criteria and separates analog similarity
   * from permanent-base shelter suitability.
   */
  function buildD4SubMetrics(analysis, ideal) {
    const target = ideal || {};
    const isMoon = target.astroMode === 'lunar_extremes' ||
      (analysis && /moon/i.test(String(analysis.targetBody || analysis.body || '')));
    const depthTarget = numOrNull(target.shieldingTarget) ?? (isMoon ? 8.0 : 6.0);
    const tempTarget = numOrNull(target.tempMeanTarget) ?? (isMoon ? -53.0 : -63.0);
    const metrics = [];

    // Target-specific normalized D4 weights (sum of active/applicable weights = 1.00)
    // Mars: Surface Aridity (0.15), Cryo/Permafrost (0.20), Subsurface Ice (0.00 - unassessable via point API),
    //       Cavities/Lava Tubes (0.30), Geological Shielding (0.20), Thermal Stability (0.15) -> sum = 1.00
    // Moon: Vacuum-anhydrous body — meteoric aridity (0.00) and terrestrial permafrost (0.00) excluded;
    //       Cavities/Lava Tubes (0.50), Geological Shielding (0.35), Thermal Stability (0.15) -> sum = 1.00
    const weights = isMoon
      ? { surface: 0.0, permafrost: 0.0, subIce: 0.0, cavities: 0.50, shielding: 0.35, thermal: 0.15 }
      : { surface: 0.15, permafrost: 0.20, subIce: 0.0, cavities: 0.30, shielding: 0.20, thermal: 0.15 };

    const push = (key, label, indicator, baseScore, weight, explanation, role = 'similarity') => {
      const epistemic = indicator ? indicator.epistemic : 'UNK';
      const creditFactor = SIMILARITY_CREDIT[epistemic] ?? 0;
      const raw = baseScore === null ? null : baseScore;
      const applicable = weight > 0;
      const score = (!applicable || raw === null || creditFactor === 0)
        ? null
        : clamp(Math.round(raw * creditFactor), 0, 100);
      metrics.push({
        key,
        label,
        score,
        baseScore: raw,
        creditFactor,
        weight,
        applicable,
        role,
        status: epistemic,
        claim: indicator ? indicator.claim : 'NOT_ASSESSED',
        measuredValue: indicator ? indicator.value : null,
        unit: indicator ? indicator.unit : '',
        explanation: explanation || (indicator ? indicator.basis : 'No indicator available.')
      });
    };

    // ---- 1. Surface water availability (Mars only; excluded on Moon) ----
    const precip = findIndicator(analysis, 'surface_water', 'annual_precipitation');
    const aridity = findIndicator(analysis, 'surface_water', 'aridity_class');
    let surfaceBase = null;
    if (!isMoon) {
      if (aridity && typeof aridity.value === 'string') {
        if (/hyper-arid/.test(aridity.value)) surfaceBase = 100;
        else if (/^arid/.test(aridity.value)) surfaceBase = 78;
        else if (/semi-arid/.test(aridity.value)) surfaceBase = 48;
        else if (/sub-humid|humid/.test(aridity.value)) surfaceBase = 18;
      } else if (precip && numOrNull(precip.value) !== null) {
        const p = numOrNull(precip.value);
        surfaceBase = p < 50 ? 100 : p < 200 ? 78 : p < 500 ? 48 : 18;
      }
    }
    push('d4_surface_water', 'Surface Water Availability',
      aridity || precip, surfaceBase, weights.surface,
      isMoon
        ? 'Excluded for Moon target: the Moon is an airless vacuum body where terrestrial meteoric aridity bands are physically inapplicable.'
        : 'D4 credit for how Mars-like (hyper-arid) the surface-water regime is; derived from the aridity class.',
      'similarity');

    // ---- 2. Ice & permafrost (Mars only; excluded on Moon) ----
    const permafrost = findIndicator(analysis, 'ice_permafrost', 'permafrost_thermal_likelihood');
    let permafrostBase = null;
    if (!isMoon && permafrost && typeof permafrost.value === 'string') {
      permafrostBase = /thermally possible/.test(permafrost.value) ? 85 : 35;
    }
    push('d4_ice_permafrost', 'Ice & Permafrost',
      permafrost, permafrostBase, weights.permafrost,
      isMoon
        ? 'Excluded for Moon target: lunar polar volatiles occur in permanently shadowed vacuum cold traps (25-35 K), not atmospheric permafrost.'
        : 'D4 credit for cryogenic (permafrost-capable) terrain; thermally DERIVED, INDICATED only.',
      'similarity');

    // ---- 3. Subsurface ice potential ----
    const icePresence = findIndicator(analysis, 'subsurface_ice', 'subsurface_ice_presence') ||
                        findIndicator(analysis, 'subsurface_ice', 'lunar_polar_ice');
    const sharadArchive = findIndicator(analysis, 'subsurface_ice', 'sharad_instrument_coverage');
    const iceIndicator = icePresence || sharadArchive;
    push('d4_subsurface_ice', 'Subsurface Ice Potential',
      iceIndicator, null, weights.subIce,
      'No similarity credit: subsurface ice presence is NOT_ASSESSED with available point data (excluded from active weight denominator).',
      'similarity');

    // ---- 4. Cavities / lava tubes ----
    const volcanic = findIndicator(analysis, 'cavities_lava_tubes', 'volcanic_lithology');
    let cavityBase = null;
    if (volcanic && typeof volcanic.value === 'string') {
      cavityBase = /volcanic rocks present/.test(volcanic.value) ? 70 : 20;
    }
    push('d4_cavities', 'Cavities & Lava Tubes',
      volcanic, cavityBase, weights.cavities,
      'D4 credit for lava-tube-prone volcanic terrain; volcanic lithology is a necessary geological precondition, not a confirmed cavity detection.',
      'similarity');

    // ---- 5. Geological shielding (Dual role: analog overburden + settlement shelter suitability) ----
    const depthInd = findIndicator(analysis, 'shielding_shelter', 'overburden_depth');
    const depthVal = depthInd ? numOrNull(depthInd.value) : null;
    const depthBase = scoreDepthAgainstTarget(depthVal, depthTarget);
    push('d4_shielding', 'Geological Shielding',
      depthInd, depthBase, weights.shielding,
      `Overburden depth vs target (>=${depthTarget} m), using the documented depth-vs-target transform.`,
      'both');

    // ---- 6. Thermal stability ----
    const tempInd = findIndicator(analysis, 'water_stability_thermal', 'mean_annual_temperature');
    const thermoInd = findIndicator(analysis, 'water_stability_thermal', 'liquid_water_stability');
    const tempVal = tempInd ? numOrNull(tempInd.value) : null;
    const tempBase = scoreTempAgainstTarget(tempVal, tempTarget, 1.1);
    push('d4_thermal_stability', 'Thermal Stability',
      tempInd || thermoInd, tempBase, weights.thermal,
      `Mean annual temperature vs target (${tempTarget} C), using the aligned 1.1/deg C thermal penalty.`,
      'both');

    return metrics;
  }

  /**
   * Aggregate evaluation. Produces a result object shaped so it can replace the
   * D4 entry in the existing `dimensions` map while explicitly separating
   * `environmentalSimilarity` (analog fidelity) from `settlementShelterSuitability`
   * (permanent human base shelter suitability).
   */
  function evaluateD4(subMetrics) {
    const applicableMetrics = subMetrics.filter(m => m.weight > 0);
    const valid = applicableMetrics.filter(m => m.score !== null && Number.isFinite(m.score));
    const totalWeight = applicableMetrics.reduce((a, m) => a + m.weight, 0);
    const activeWeight = valid.reduce((a, m) => a + m.weight, 0);

    if (!valid.length || activeWeight <= 0) {
      return {
        score: null,
        environmentalSimilarity: null,
        settlementShelterSuitability: null,
        evidenceQuality: 0,
        coverage: 0,
        confidence: 0,
        epistemicStatus: 'unknown',
        validCount: 0,
        totalCount: applicableMetrics.length || subMetrics.length,
        unsupportedClaims: [],
        explanation: 'Unknown (no D4 sub-metric could be scored; excluded from the overall denominator).',
        metrics: subMetrics
      };
    }

    // 1. Environmental similarity — restricted to analog geological/cryosphere regime metrics
    const simMetrics = valid.filter(m => m.role === 'similarity' || m.role === 'both');
    const simWeight = simMetrics.reduce((a, m) => a + m.weight, 0);
    const similarity = simWeight > 0
      ? clamp(Math.round(simMetrics.reduce((a, m) => a + m.score * m.weight, 0) / simWeight), 0, 100)
      : null;

    // 2. Permanent-base settlement shelter suitability — calculated from physical overburden
    //    depth and cavity/thermal shelter metrics without conflating surface analog aridity.
    const shelterMetrics = subMetrics.filter(m =>
      (m.key === 'd4_shielding' || m.key === 'd4_cavities' || m.key === 'd4_thermal_stability') &&
      m.baseScore !== null && Number.isFinite(m.baseScore)
    );
    const shelterSuitability = shelterMetrics.length > 0
      ? clamp(Math.round(
          shelterMetrics.reduce((a, m) => a + m.baseScore * (m.creditFactor || 0.25), 0) / shelterMetrics.length
        ), 0, 100)
      : null;

    // 3. Evidence quality — independent of similarity. Uses the epistemic factor of
    //    each present metric weighted by its importance.
    const evidenceQuality = clamp(Math.round(
      valid.reduce((a, m) => a + (EPISTEMIC_FACTOR[m.status] ?? 0) * m.weight, 0) / activeWeight * 100
    ), 0, 100);

    const coverage = clamp(Math.round((activeWeight / (totalWeight || 1)) * 100), 0, 100);
    const confidence = clamp(Math.round(coverage * 0.55 + evidenceQuality * 0.45), 10, 100);

    const counts = { MEAS: 0, DER: 0, INF: 0, UNK: 0 };
    valid.forEach(m => { if (counts[m.status] !== undefined) counts[m.status]++; });
    let dominant = 'DER';
    if (counts.MEAS >= counts.DER && counts.MEAS >= counts.INF) dominant = 'MEAS';
    else if (counts.INF > counts.MEAS && counts.INF >= counts.DER) dominant = 'INF';

    const unsupportedClaims = valid
      .filter(m => m.status === 'INF' && m.score !== null && m.score > 0)
      .map(m => ({ key: m.key, label: m.label, claim: m.claim, creditFactor: m.creditFactor }));

    const epistemicToLegacy = { MEAS: 'measured', DER: 'derived', INF: 'inferred', UNK: 'unknown' };

    const parts = valid.map(m => `${m.label} ${m.score}%`);
    const damped = valid.filter(m => m.status === 'INF').length;
    const shelterTag = shelterSuitability !== null ? ` • shelter suitability ${shelterSuitability}%` : '';
    const explanation = `${parts.join(', ')} [${dominant} • ${valid.length}/${applicableMetrics.length} applicable params • `
      + `analog similarity ${similarity}%${shelterTag} • evidence ${evidenceQuality}% • ±${Math.max(2, Math.round((100 - confidence) * 0.18))}%`
      + `${damped ? ` • ${damped} inferred metric(s) damped to <=25% credit` : ''}].`;

    return {
      score: similarity,
      environmentalSimilarity: similarity,
      settlementShelterSuitability: shelterSuitability,
      evidenceQuality,
      coverage,
      confidence,
      epistemicStatus: epistemicToLegacy[dominant] || 'derived',
      epistemicClass: dominant,
      validCount: valid.length,
      totalCount: applicableMetrics.length,
      unsupportedClaims,
      explanation,
      metrics: subMetrics
    };
  }

  /**
   * Convenience entry point used by the app.
   * @param {object} analysis — Phase 3 result (site.d4Analysis)
   * @param {object} ideal    — the active planetary target's `ideal` block
   */
  function scoreD4(analysis, ideal) {
    if (!analysis || !Array.isArray(analysis.categories)) return null;
    const subMetrics = buildD4SubMetrics(analysis, ideal);
    const result = evaluateD4(subMetrics);
    result.scoringVersion = SCORING_VERSION;
    result.analysisSchemaVersion = analysis.schemaVersion || null;
    result.integrityPassed = analysis.integrity ? analysis.integrity.passed : null;
    return result;
  }

  const D4_SCORING = Object.freeze({
    SCORING_VERSION,
    EPISTEMIC_FACTOR,
    SIMILARITY_CREDIT,
    scoreD4,
    buildD4SubMetrics,
    evaluateD4,
    scoreDepthAgainstTarget,
    scoreTempAgainstTarget
  });

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = D4_SCORING;
  }
  root.AstroLocD4Scoring = D4_SCORING;
})(typeof window !== 'undefined' ? window : globalThis);
