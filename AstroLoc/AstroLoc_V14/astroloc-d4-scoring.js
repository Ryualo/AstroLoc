/**
 * astroloc-d4-scoring.js
 * AstroLoc Phase 4 — D4 scoring layer.
 *
 * Separates three distinct quantities that must never be conflated:
 *
 *   environmentalSimilarity — how well the site matches the target body's D4
 *                             regime (0–100). This is what feeds the overall 5D
 *                             score, preserving the existing contract.
 *   evidenceQuality         — how well-supported that similarity is (0–100),
 *                             from the epistemic mix (MEAS/DER/INF/UNK).
 *   coverage                — fraction of D4 sub-metrics actually present.
 *
 * Design rules:
 *  - Reuses ONLY the bounded transforms already documented and in use in the
 *    existing AstroLoc engine (depth-vs-target, temperature-vs-target). No new
 *    formula is invented here; the provenance of each transform is stated.
 *  - An INF indicator can never be promoted to a measured observation: its
 *    similarity contribution is damped AND it is flagged unsupported.
 *  - Missing measurements reduce coverage; they never silently score 0.
 *  - When no Phase 3 analysis exists, the caller keeps the legacy path.
 */
(function (root) {
  'use strict';

  const SCORING_VERSION = 'astroloc-d4-scoring-v1';

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
   * as if they were observed. This is the mechanism that prevents unsupported
   * inferred values from masquerading as confirmed observations.
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
   * of 15 below it. Reused verbatim so D4 scoring stays consistent.
   */
  function scoreDepthAgainstTarget(depth, target) {
    if (depth === null || target === null || target <= 0) return null;
    if (depth >= target) return 100;
    return clamp(Math.round(100 - ((target - depth) / Math.max(1, target)) * 65), 15, 100);
  }

  /**
   * Temperature-regime transform. Documented in the existing engine as an
   * absolute-difference penalty against the target mean. Reused, not invented.
   */
  function scoreTempAgainstTarget(temp, target, perDegreePenalty) {
    if (temp === null || target === null) return null;
    return clamp(Math.round(100 - Math.abs(temp - target) * (perDegreePenalty || 2.4)), 10, 100);
  }

  /**
   * Builds the D4 sub-metric list from a Phase 3 analysis result.
   *
   * Each sub-metric carries:
   *   score    — environmental-similarity credit contributed (drives D4 score)
   *   weight   — relative importance within D4
   *   status   — MEAS|DER|INF|UNK, mapped into the app's epistemic vocabulary
   *   claim    — the Phase 3 claim state (CONFIRMED_MEASURED / INDICATED / ...)
   *   note     — the human explanation for that sub-metric
   *
   * Inferred indicators get SIMILARITY_CREDIT * their base credit, so they can
   * never contribute as much as a measured observation.
   */
  function buildD4SubMetrics(analysis, ideal) {
    const target = ideal || {};
    const depthTarget = numOrNull(target.shieldingTarget);
    const tempTarget = numOrNull(target.tempMeanTarget);
    const metrics = [];

    const push = (key, label, indicator, baseScore, weight, explanation) => {
      const epistemic = indicator ? indicator.epistemic : 'UNK';
      const creditFactor = SIMILARITY_CREDIT[epistemic] ?? 0;
      const raw = baseScore === null ? null : baseScore;
      // An indicator with zero credit (UNK, or no indicator at all) contributes
      // NO similarity and must score null — not 0 — so it is excluded from the
      // denominator rather than silently dragging the score down or counting as
      // an assessed measurement.
      const score = (raw === null || creditFactor === 0)
        ? null
        : clamp(Math.round(raw * creditFactor), 0, 100);
      metrics.push({
        key,
        label,
        score,
        baseScore: raw,
        creditFactor,
        weight,
        status: epistemic,
        claim: indicator ? indicator.claim : 'NOT_ASSESSED',
        measuredValue: indicator ? indicator.value : null,
        unit: indicator ? indicator.unit : '',
        explanation: explanation || (indicator ? indicator.basis : 'No indicator available.')
      });
    };

    // ---- 1. Surface water availability ----
    const precip = findIndicator(analysis, 'surface_water', 'annual_precipitation');
    const aridity = findIndicator(analysis, 'surface_water', 'aridity_class');
    // Hyper-arid Earth is a better Mars analog than humid Earth. Map the
    // aridity class onto a 0-100 analog credit using the SAME thresholds the
    // Phase 3 classifier used, inverted (drier -> closer to Mars).
    let surfaceBase = null;
    if (aridity && typeof aridity.value === 'string') {
      if (/hyper-arid/.test(aridity.value)) surfaceBase = 100;
      else if (/^arid/.test(aridity.value)) surfaceBase = 78;
      else if (/semi-arid/.test(aridity.value)) surfaceBase = 48;
      else if (/sub-humid|humid/.test(aridity.value)) surfaceBase = 18;
    } else if (precip && numOrNull(precip.value) !== null) {
      const p = numOrNull(precip.value);
      surfaceBase = p < 50 ? 100 : p < 200 ? 78 : p < 500 ? 48 : 18;
    }
    push('d4_surface_water', 'Surface Water Availability',
      aridity || precip, surfaceBase, 0.15,
      'D4 credit for how Mars-like (dry) the surface-water regime is; derived from the aridity class.');

    // ---- 2. Ice & permafrost ----
    const permafrost = findIndicator(analysis, 'ice_permafrost', 'permafrost_thermal_likelihood');
    let permafrostBase = null;
    if (permafrost && typeof permafrost.value === 'string') {
      permafrostBase = /thermally possible/.test(permafrost.value) ? 85 : 35;
    }
    push('d4_ice_permafrost', 'Ice & Permafrost',
      permafrost, permafrostBase, 0.15,
      'D4 credit for cryogenic (permafrost-capable) terrain; thermally DERIVED, INDICATED only.');

    // ---- 3. Subsurface ice potential ----
    const icePresence = findIndicator(analysis, 'subsurface_ice', 'subsurface_ice_presence');
    const sharadArchive = findIndicator(analysis, 'subsurface_ice', 'sharad_instrument_coverage');
    const iceIndicator = icePresence || sharadArchive;
    // No base score: the engine may report archive existence, never ice presence.
    // Hence subsurface ice contributes NO similarity unless a MEAS presence
    // claim exists (which the Phase 3 engine deliberately never makes).
    push('d4_subsurface_ice', 'Subsurface Ice Potential',
      iceIndicator, null, 0.15,
      'No similarity credit: subsurface ice presence is NOT_ASSESSED with available point data.');

    // ---- 4. Cavities / lava tubes ----
    const volcanic = findIndicator(analysis, 'cavities_lava_tubes', 'volcanic_lithology');
    let cavityBase = null;
    if (volcanic && typeof volcanic.value === 'string') {
      cavityBase = /volcanic rocks present/.test(volcanic.value) ? 70 : 20;
    }
    push('d4_cavities', 'Cavities & Lava Tubes',
      volcanic, cavityBase, 0.20,
      'D4 credit for lava-tube-prone volcanic terrain; volcanic lithology is a prerequisite, not a cavity detection.');

    // ---- 5. Geological shielding ----
    const depthInd = findIndicator(analysis, 'shielding_shelter', 'overburden_depth');
    const depthVal = depthInd ? numOrNull(depthInd.value) : null;
    const depthBase = scoreDepthAgainstTarget(depthVal, depthTarget);
    push('d4_shielding', 'Geological Shielding',
      depthInd, depthBase, 0.25,
      `Overburden depth vs target (>=${depthTarget === null ? '?' : depthTarget} m), using the documented depth-vs-target transform.`);

    // ---- 6. Thermal stability ----
    const tempInd = findIndicator(analysis, 'water_stability_thermal', 'mean_annual_temperature');
    const thermoInd = findIndicator(analysis, 'water_stability_thermal', 'liquid_water_stability');
    const tempVal = tempInd ? numOrNull(tempInd.value) : null;
    const tempBase = scoreTempAgainstTarget(tempVal, tempTarget, 2.4);
    push('d4_thermal_stability', 'Thermal Stability',
      tempInd || thermoInd, tempBase, 0.10,
      `Mean annual temperature vs target (${tempTarget === null ? '?' : tempTarget} C), using the documented absolute-difference penalty.`);

    return metrics;
  }

  /**
   * Aggregate evaluation. Produces a result object shaped so it can replace the
   * D4 entry in the existing `dimensions` map without changing any consumer.
   *
   * Returns { score, coverage, confidence, epistemicStatus, validCount,
   *           totalCount, evidenceQuality, environmentalSimilarity,
   *           unsupportedClaims, explanation, metrics }
   */
  function evaluateD4(subMetrics) {
    const valid = subMetrics.filter(m => m.score !== null && Number.isFinite(m.score));
    const totalWeight = subMetrics.reduce((a, m) => a + m.weight, 0);
    const activeWeight = valid.reduce((a, m) => a + m.weight, 0);

    if (!valid.length || activeWeight <= 0) {
      return {
        score: null,
        environmentalSimilarity: null,
        evidenceQuality: 0,
        coverage: 0,
        confidence: 0,
        epistemicStatus: 'unknown',
        validCount: 0,
        totalCount: subMetrics.length,
        unsupportedClaims: [],
        explanation: 'Unknown (no D4 sub-metric could be scored; excluded from the overall denominator).',
        metrics: subMetrics
      };
    }

    // Environmental similarity — the score fed into the 5D engine.
    const similarity = clamp(Math.round(
      valid.reduce((a, m) => a + m.score * m.weight, 0) / activeWeight
    ), 0, 100);

    // Evidence quality — independent of similarity. Uses the epistemic factor of
    // each present metric weighted by its importance.
    const evidenceQuality = clamp(Math.round(
      valid.reduce((a, m) => a + (EPISTEMIC_FACTOR[m.status] ?? 0) * m.weight, 0) / activeWeight * 100
    ), 0, 100);

    const coverage = clamp(Math.round((activeWeight / (totalWeight || 1)) * 100), 0, 100);

    // Confidence blends coverage and evidence quality — same shape as the
    // existing evaluateWeightedDimension so consumers behave identically.
    const confidence = clamp(Math.round(coverage * 0.55 + evidenceQuality * 0.45), 10, 100);

    const counts = { MEAS: 0, DER: 0, INF: 0, UNK: 0 };
    valid.forEach(m => { if (counts[m.status] !== undefined) counts[m.status]++; });
    let dominant = 'DER';
    if (counts.MEAS >= counts.DER && counts.MEAS >= counts.INF) dominant = 'MEAS';
    else if (counts.INF > counts.MEAS && counts.INF >= counts.DER) dominant = 'INF';

    // Any INF indicator that contributed similarity is flagged as unsupported so
    // the UI can refuse to present it as a confirmed observation.
    const unsupportedClaims = valid
      .filter(m => m.status === 'INF' && m.score !== null && m.score > 0)
      .map(m => ({ key: m.key, label: m.label, claim: m.claim, creditFactor: m.creditFactor }));

    const epistemicToLegacy = { MEAS: 'measured', DER: 'derived', INF: 'inferred', UNK: 'unknown' };

    const parts = valid.map(m => `${m.label} ${m.score}%`);
    const damped = valid.filter(m => m.status === 'INF').length;
    const explanation = `${parts.join(', ')} [${dominant} • ${valid.length}/${subMetrics.length} params • `
      + `similarity ${similarity}% • evidence ${evidenceQuality}% • ±${Math.max(2, Math.round((100 - confidence) * 0.18))}%`
      + `${damped ? ` • ${damped} inferred metric(s) damped to <=25% credit` : ''}].`;

    return {
      score: similarity,
      environmentalSimilarity: similarity,
      evidenceQuality,
      coverage,
      confidence,
      epistemicStatus: epistemicToLegacy[dominant] || 'derived',
      epistemicClass: dominant,
      validCount: valid.length,
      totalCount: subMetrics.length,
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

