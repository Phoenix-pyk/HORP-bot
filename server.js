const express = require('express');
const path = require('path');
const { filterByDietaryAndAllergies } = require('./engine');

const app = express();
const PORT = 3000;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/**
 * POST /api/run
 * Accepts a tableProfile and runs combined + per-allergy filtering passes
 */
app.post('/api/run', (req, res) => {
  try {
    const tableProfile = req.body;

    // Validate required fields
    if (!tableProfile) {
      return res.status(400).json({ error: 'Missing tableProfile in request body' });
    }

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
      safeForAll: combinedResults.safe || [],
      canBeModifiedForAll: combinedResults.canBeModified || [],
      filteredForAll: combinedResults.filtered || [],
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

      report.safeByAllergy[allergen] = singleAllergyResults.safe || [];
    });

    res.json(report);
  } catch (error) {
    console.error('API Error:', error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Start server
app.listen(PORT, () => {
  console.log(`HORP Bot server listening on port ${PORT}`);
});
