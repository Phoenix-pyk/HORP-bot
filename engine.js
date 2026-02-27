// Menu filtering engine for HORP Bot
// Layer 1: Filter by dietary preference and allergies

const fs = require('fs');
const path = require('path');

// Load menu data
const menuData = JSON.parse(fs.readFileSync(path.join(__dirname, 'menu.json'), 'utf8'));

/**
 * Layer 1: Filter menu items by dietary preference and allergies
 * @param {Array<string>} dietaryPreferences - e.g., ["vegetarian", "vegan"]
 * @param {Array<string>} allergies - e.g., ["gluten", "shellfish"]
 * @param {Array<string>} avoidIngredientFlags - e.g., ["sesame_seed", "pork"]
 * @param {boolean} crossContactOk - Allow items with cross-contact risk (default: false)
 * @param {Array<string>} tolerateFlags - Ingredient flags user tolerates e.g., ["soy_sauce", "sesame_oil"]
 * @returns {Object} Filtered results with safe and filtered items
 */
function filterByDietaryAndAllergies(dietaryPreferences = [], allergies = [], avoidIngredientFlags = [], crossContactOk = false, tolerateFlags = []) {
  const results = {
    safe: [],
    filtered: [],
    canBeModified: []
  };

  (menuData.items || []).forEach(item => {
    const itemStatus = {
      id: item.id,
      name: item.name,
      category: item.category,
      reasons: []
    };

    // Check dietary preferences
    let isDietaryCompliant = checkDietaryCompliance(item, dietaryPreferences, itemStatus);
    
    // Check allergies and ingredient flags WITH tolerance knowledge
    let isCompliant = checkCompliance(item, allergies, avoidIngredientFlags, crossContactOk, tolerateFlags, itemStatus);

    // Check if item can be made safe through modifications
    let canBeModifiedToSafe = false;
    let applicableMods = [];
    if (!isCompliant && (item.modifications || []).length > 0) {
      canBeModifiedToSafe = canModificationsMakeItemSafe(item, allergies, avoidIngredientFlags, crossContactOk, tolerateFlags);
      if (canBeModifiedToSafe) {
        applicableMods = getApplicableModifications(item, allergies, avoidIngredientFlags);
      }
    }

    // Categorize results
    if (isDietaryCompliant && isCompliant) {
      results.safe.push(itemStatus);
    } else if (canBeModifiedToSafe) {
      itemStatus.modifications = applicableMods;
      results.canBeModified.push(itemStatus);
    } else {
      results.filtered.push(itemStatus);
    }
  });

  return results;
}

/**
 * Check if item meets dietary preferences
 */
function checkDietaryCompliance(item, dietaryPreferences, itemStatus) {
  if (dietaryPreferences.length === 0) return true;

  // For now, check tags for vegetarian/vegan
  const vegetarianItems = item.tags && item.tags.includes('vegetarian');
  const veganItems = item.tags && item.tags.includes('vegan');

  for (const pref of dietaryPreferences) {
    if (pref === 'vegetarian' && !vegetarianItems) {
      itemStatus.reasons.push('Contains meat or animal products - not vegetarian');
      return false;
    }
    if (pref === 'vegan' && !veganItems) {
      itemStatus.reasons.push('Contains dairy, eggs or animal products - not vegan');
      return false;
    }
  }

  return true;
}

/**
 * Check if item contains any forbidden allergens or ingredient flags
 * Takes tolerates flags into account - if allergen only appears in tolerated flags, it's OK
 */
function checkCompliance(item, allergies, avoidIngredientFlags, crossContactOk, tolerateFlags, itemStatus) {
  if (allergies.length === 0 && avoidIngredientFlags.length === 0) return true;

  let hasIssue = false;

  // Check all components for allergens and ingredient flags
  (item.components || []).forEach(component => {
    const forbiddenAllergens = (component.contains_allergens || []).filter(allergen => 
      allergies.includes(allergen)
    );

    if (forbiddenAllergens.length > 0) {
      // Check if user tolerates the forms this allergen appears in
      const tolerableAllergens = forbiddenAllergens.filter(allergen => {
        return isAllergenTolerable(component, allergen, tolerateFlags);
      });

      // Only block if there are allergens that aren't tolerable
      const intolerablea = forbiddenAllergens.filter(a => !tolerableAllergens.includes(a));
      if (intolerablea.length > 0) {
        itemStatus.reasons.push(
          `"${component.name}" contains intolerable allergen(s): ${intolerablea.join(', ')}`
        );
        hasIssue = true;
      } else if (tolerableAllergens.length > 0) {
        itemStatus.reasons.push(
          `"${component.name}" contains tolerated form: ${tolerableAllergens.join(', ')}`
        );
      }
    }

    const forbiddenFlags = (component.contains_ingredient_flags || []).filter(flag => 
      avoidIngredientFlags.includes(flag)
    );

    if (forbiddenFlags.length > 0) {
      itemStatus.reasons.push(
        `"${component.name}" contains ingredient flag(s): ${forbiddenFlags.join(', ')}`
      );
      hasIssue = true;
    }
  });

  // Check cross-contact risk only if crossContactOk is false
  if (!crossContactOk && item.cross_contact_risk && item.cross_contact_risk.length > 0) {
    const forbiddenRisks = item.cross_contact_risk.filter(risk => 
      allergies.includes(risk)
    );
    if (forbiddenRisks.length > 0) {
      itemStatus.reasons.push(
        `Cross-contact risk: ${forbiddenRisks.join(', ')}`
      );
      hasIssue = true;
    }
  }

  return !hasIssue;
}

/**
 * Check if modifications can make item allergen-safe
 * Applies ALL applicable modifications together, not individually
 */
function canModificationsMakeItemSafe(item, allergies, avoidIngredientFlags, crossContactOk, tolerateFlags = []) {
  if (!item.modifications || item.modifications.length === 0) return false;

  // Get ALL applicable modifications for these allergens and ingredient flags
  const applicableMods = (item.modifications || []).filter(mod => {
    if (mod.when && (mod.when.avoid_allergens || []).length > 0) {
      if ((mod.when.avoid_allergens || []).some(allergen => allergies.includes(allergen))) {
        return true;
      }
    }
    if (mod.when && (mod.when.avoid_ingredient_flags || []).length > 0) {
      if ((mod.when.avoid_ingredient_flags || []).some(flag => avoidIngredientFlags.includes(flag))) {
        return true;
      }
    }
    return false;
  });

  // If no applicable mods, can't make it safe
  if (applicableMods.length === 0) return false;

  // Apply ALL applicable modifications together to get effective components
  let effectiveComponents = JSON.parse(JSON.stringify(item.components || []));
  
  for (const mod of applicableMods) {
    effectiveComponents = applyModification(effectiveComponents, mod);
  }
  
  // Re-check allergens and ingredient flags once with all modifications applied together
  const testStatus = { reasons: [] };
  const isNowSafe = checkComplianceOnComponents(
    effectiveComponents, 
    item.cross_contact_risk || [],
    allergies,
    avoidIngredientFlags,
    crossContactOk,
    tolerateFlags,
    testStatus
  );
  
  return isNowSafe;
}

/**
 * Apply a modification to components
 * @param {Array} components - Original components
 * @param {Object} modification - Modification object with action and target_component
 * @returns {Array} Effective components after modification
 */
function applyModification(components, modification) {
  if (!components || !Array.isArray(components)) components = [];
  let effectiveComponents = JSON.parse(JSON.stringify(components)); // Deep copy
  
  if (modification.action === 'remove') {
    effectiveComponents = (effectiveComponents || []).filter(comp => 
      comp.name !== modification.target_component
    );
  } else if (modification.action === 'substitute') {
    // For substitution, we assume the substitute is safe (or we'd need allergen data for it)
    // Mark as substituted so we know it's been handled
    effectiveComponents = effectiveComponents.map(comp => {
      if (comp.name === modification.target_component) {
        return { 
          name: modification.target_component, 
          contains_allergens: [],
          contains_ingredient_flags: [],
          notes: `substituted with ${modification.substitute_with}`
        };
      }
      return comp;
    });
  }
  
  return effectiveComponents;
}

/**
 * Check compliance on a list of components (used after modifications)
 * Also considers tolerated flags
 */
function checkComplianceOnComponents(components, crossContactRisk, allergies, avoidIngredientFlags, crossContactOk, tolerateFlags = [], itemStatus) {
  if (allergies.length === 0 && avoidIngredientFlags.length === 0) return true;

  let hasIssue = false;

  // Check components for allergens and ingredient flags
  (components || []).forEach(component => {
    const forbiddenAllergens = (component.contains_allergens || []).filter(allergen => 
      allergies.includes(allergen)
    );

    if (forbiddenAllergens.length > 0) {
      // Check if user tolerates the forms this allergen appears in
      const tolerableAllergens = forbiddenAllergens.filter(allergen => {
        return isAllergenTolerable(component, allergen, tolerateFlags);
      });

      // Only block if there are allergens that aren't tolerable
      const intolerablea = forbiddenAllergens.filter(a => !tolerableAllergens.includes(a));
      if (intolerablea.length > 0) {
        itemStatus.reasons.push(
          `"${component.name}" contains intolerable allergen(s): ${intolerablea.join(', ')}`
        );
        hasIssue = true;
      }
    }

    const forbiddenFlags = (component.contains_ingredient_flags || []).filter(flag => 
      avoidIngredientFlags.includes(flag)
    );

    if (forbiddenFlags.length > 0) {
      itemStatus.reasons.push(
        `"${component.name}" contains ingredient flag(s): ${forbiddenFlags.join(', ')}`
      );
      hasIssue = true;
    }
  });

  // Check cross-contact risk only if crossContactOk is false
  if (!crossContactOk && (crossContactRisk || []).length > 0) {
    const forbiddenRisks = (crossContactRisk || []).filter(risk => 
      allergies.includes(risk)
    );
    if (forbiddenRisks.length > 0) {
      itemStatus.reasons.push(
        `Cross-contact risk: ${forbiddenRisks.join(', ')}`
      );
      hasIssue = true;
    }
  }

  return !hasIssue;
}

/**
 * Get applicable modifications for an item based on allergies and ingredient flags
 */
function getApplicableModifications(item, allergies, avoidIngredientFlags) {
  return (item.modifications || []).filter(mod => {
    if (mod.when && (mod.when.avoid_allergens || []).length > 0) {
      if ((mod.when.avoid_allergens || []).some(allergen => allergies.includes(allergen))) {
        return true;
      }
    }
    if (mod.when && (mod.when.avoid_ingredient_flags || []).length > 0) {
      if ((mod.when.avoid_ingredient_flags || []).some(flag => avoidIngredientFlags.includes(flag))) {
        return true;
      }
    }
    return false;
  });
}

/**
 * Layer 2: Filter by allergen tolerances (processed forms)
 * Some customers can tolerate specific processed forms of allergens
 * Mapping: gluten→soy_sauce, shellfish→oyster_sauce, peanut→peanut_oil, sesame→sesame_oil
 * @param {Object} layer1Results - Results from filterByDietaryAndAllergies
 * @param {Array<string>} allergies - User's allergies
 * @param {Object} tolerances - e.g., { gluten: { canUseSoySauce: true }, sesame: { canUseSesameOil: false } }
 * @returns {Object} Refined results with tolerance-safe items moved from filtered→safe
 */
function filterByTolerance(layer1Results, allergies, tolerances = {}) {
  if (!tolerances || Object.keys(tolerances).length === 0) {
    return layer1Results; // No tolerances specified, return as-is
  }

  const toleranceMapping = {
    'gluten': { flag: 'soy_sauce', key: 'canUseSoySauce' },
    'shellfish': { flag: 'oyster_sauce', key: 'canUseOysterSauce' },
    'peanut': { flag: 'peanut_oil', key: 'canUsePeanutOil' },
    'sesame': { flag: 'sesame_oil', key: 'canUseSesameOil' }
  };

  const refinedResults = {
    safe: [...layer1Results.safe],
    filtered: [],
    canBeModified: [...layer1Results.canBeModified]
  };

  // Re-evaluate filtered items with tolerance knowledge
  (layer1Results.filtered || []).forEach(filteredItem => {
    const originalItem = (menuData.items || []).find(item => item.id === filteredItem.id);
    if (!originalItem) {
      refinedResults.filtered.push(filteredItem);
      return;
    }

    let isSafeWithTolerance = true;
    let toleranceReasoning = [];

    // Check each allergen the user avoids
    for (const allergen of allergies) {
      const mapping = toleranceMapping[allergen];
      if (!mapping) continue; // No tolerance mapping for this allergen

      const tolerance = tolerances[allergen];
      if (!tolerance || !tolerance[mapping.key]) continue; // User doesn't tolerate this form

      // User tolerates this processed form
      // Check if ALL instances of this allergen in the item ONLY use the tolerable form
      const isOnlyTolerablyPresent = checkIfOnlyTolerablyPresent(
        originalItem,
        allergen,
        mapping.flag
      );

      if (!isOnlyTolerablyPresent) {
        isSafeWithTolerance = false;
        break;
      }

      toleranceReasoning.push(`Can tolerate ${allergen} in form: ${mapping.flag}`);
    }

    if (isSafeWithTolerance && toleranceReasoning.length > 0) {
      // Move to safe with tolerance note, preserving original reasons
      const tolerantItem = { ...filteredItem };
      tolerantItem.tolerance_notes = toleranceReasoning;
      tolerantItem.toleranceAllowed = true;
      refinedResults.safe.push(tolerantItem);
    } else {
      refinedResults.filtered.push(filteredItem);
    }
  });

  return refinedResults;
}

/**
 * Check if an allergen only appears in its tolerable form (processed form)
 * @param {Object} item - Menu item
 * @param {string} allergen - e.g., "sesame"
 * @param {string} tolerableFlag - e.g., "sesame_oil"
 * @returns {boolean} True if allergen only appears via the tolerable flag
 */
function checkIfOnlyTolerablyPresent(item, allergen, tolerableFlag) {
  const components = item.components || [];

  // Check each component
  for (const component of components) {
    const hasAllergen = (component.contains_allergens || []).includes(allergen);
    
    if (hasAllergen) {
      // This component has the allergen
      // Check if it ONLY has the tolerable form (e.g., sesame_oil, not sesame_seed)
      const flags = component.contains_ingredient_flags || [];
      const hasTolerablyForm = flags.includes(tolerableFlag);
      const hasOtherForms = flags.filter(f => 
        f !== tolerableFlag && isRelatedToAllergen(f, allergen)
      ).length > 0;

      // If it has the intolerable form alongside, fail
      if (hasOtherForms) {
        return false;
      }

      // If it doesn't have the tolerable form at all, fail
      if (!hasTolerablyForm) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Check if an allergen is tolerable in a specific component
 * Simple rule: If allergen is present, it's only tolerable if component contains
 * at least one of the user's tolerateFlags that relates to this allergen
 * @param {Object} component - Component object
 * @param {string} allergen - e.g., "sesame"
 * @param {Array<string>} tolerateFlags - e.g., ["sesame_oil", "soy_sauce"]
 * @returns {boolean} True if component has at least one tolerated form of this allergen
 */
function isAllergenTolerable(component, allergen, tolerateFlags = []) {
  if (tolerateFlags.length === 0) {
    return false; // No tolerances specified, can't tolerate any allergen
  }

  // Get flags from this component
  const componentFlags = component.contains_ingredient_flags || [];

  // Find which tolerated flags are related to this allergen
  const toleratedFormsOfAllergen = tolerateFlags.filter(flag => 
    isRelatedToAllergen(flag, allergen)
  );

  // Component is tolerable if it contains at least one of the tolerated forms
  return toleratedFormsOfAllergen.some(toleratedFlag => 
    componentFlags.includes(toleratedFlag)
  );
}

/**
 * Check if an ingredient flag is related to an allergen
 * @param {string} flag - e.g., "sesame_seed"
 * @param {string} allergen - e.g., "sesame"
 * @returns {boolean}
 */
function isRelatedToAllergen(flag, allergen) {
  const relations = {
    'sesame': ['sesame_seed', 'sesame_oil'],
    'peanut': ['peanut_oil'],
    'gluten': ['soy_sauce'],
    'shellfish': ['oyster_sauce']
  };

  const relatedFlags = relations[allergen] || [];
  return relatedFlags.includes(flag);
}

/**
 * Generate a multi-allergy report showing safe items for all combined allergies
 * and safe items for each individual allergy
 * @param {Object} tableProfile - Profile with dietary preferences, allergies, flags, tolerances, cross-contact setting
 * @returns {Object} { safeForAll, safeByAllergy }
 */
function runMultiAllergyReport(tableProfile) {
  const {
    dietaryPreferences = [],
    avoidAllergens = [],
    avoidIngredientFlags = [],
    tolerateFlags = [],
    crossContactOk = false
  } = tableProfile;

  // Single combined pass with all allergens together
  const combinedResults = filterByDietaryAndAllergies(
    dietaryPreferences,
    avoidAllergens,
    avoidIngredientFlags,
    crossContactOk,
    tolerateFlags
  );

  const report = {
    safeForAll: combinedResults.safe,
    safeByAllergy: {}
  };

  // Optional per-allergy passes
  (avoidAllergens || []).forEach(allergen => {
    const singleAllergyResults = filterByDietaryAndAllergies(
      dietaryPreferences,
      [allergen],
      avoidIngredientFlags,
      crossContactOk,
      tolerateFlags
    );

    report.safeByAllergy[allergen] = singleAllergyResults.safe;
  });

  return report;
}

// Export functions
module.exports = {
  filterByDietaryAndAllergies,
  runMultiAllergyReport,
  menuData
};
