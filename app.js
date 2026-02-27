// State management
const state = {
  step: 0,
  dietaryPreferences: [],
  avoidAllergens: [],
  avoidIngredientFlags: [],
  tolerateFlags: [],
  crossContactOk: null,
  tolerance_answers: {} // { allergen: true/false }
};

// Allergen to tolerance mapping
const allergyToleranceMap = {
  'gluten': { question: 'Gluten allergy: can they have soy sauce?', flag: 'soy_sauce' },
  'shellfish': { question: 'Shellfish allergy: can they have oyster sauce?', flag: 'oyster_sauce' },
  'peanut': { question: 'Peanut allergy: can they have peanut oil?', flag: 'peanut_oil' },
  'sesame': { question: 'Sesame allergy: can they have sesame oil?', flag: 'sesame_oil' }
};

// Base conversation steps
const baseSteps = [
  { id: 'dietary', question: 'Any dietary restrictions?', options: ['Vegetarian', 'Vegan', 'None'], mode: 'multi' },
  { id: 'allergies', question: 'Any allergies?', options: ['Gluten', 'Sesame', 'Shellfish', 'Peanut', 'None'], mode: 'multi' },
  { id: 'crossContact', question: 'Cross-contact OK?', options: ['Yes', 'No'], mode: 'single' }
];

/**
 * Get the current step based on progress
 */
function getCurrentStep() {
  if (state.step < baseSteps.length) {
    return baseSteps[state.step];
  }

  // Calculate tolerance step index
  const toleranceStepIndex = state.step - baseSteps.length;
  const selectedAllergies = state.avoidAllergens
    .filter(a => a !== 'none')
    .map(a => a.toLowerCase());
  const relevantAllergies = selectedAllergies.filter(a => allergyToleranceMap[a]);

  if (toleranceStepIndex < relevantAllergies.length) {
    const allergen = relevantAllergies[toleranceStepIndex];
    const config = allergyToleranceMap[allergen];
    return {
      id: `tolerance_${allergen}`,
      question: config.question,
      options: ['Yes', 'No'],
      mode: 'single',
      allergen: allergen,
      flag: config.flag
    };
  }

  return null; // Conversation complete
}

/**
 * Calculate total steps including conditional tolerance steps
 */
function getTotalSteps() {
  const baseCount = baseSteps.length;
  const relevantAllergies = state.avoidAllergens
    .filter(a => a !== 'none')
    .filter(a => allergyToleranceMap[a.toLowerCase()]);
  return baseCount + relevantAllergies.length;
}

/**
 * Check if current step is valid (has required selections)
 */
function isStepValid(step) {
  if (!step) return false;

  if (step.id === 'dietary') {
    return state.dietaryPreferences.length > 0;
  }
  if (step.id === 'allergies') {
    return state.avoidAllergens.length > 0;
  }
  if (step.id === 'crossContact') {
    return state.crossContactOk !== null;
  }
  if (step.id.startsWith('tolerance_')) {
    return state.tolerance_answers.hasOwnProperty(step.allergen);
  }

  return false;
}

/**
 * Check if an option is currently selected
 */
function isOptionSelected(option) {
  const step = getCurrentStep();
  if (!step) return false;

  const lowerOption = option.toLowerCase();

  if (step.id === 'dietary') {
    return state.dietaryPreferences.includes(lowerOption);
  }
  if (step.id === 'allergies') {
    return state.avoidAllergens.includes(lowerOption);
  }
  if (step.id === 'crossContact') {
    if (option === 'Yes') return state.crossContactOk === true;
    if (option === 'No') return state.crossContactOk === false;
  }
  if (step.id.startsWith('tolerance_')) {
    const answered = state.tolerance_answers[step.allergen];
    if (option === 'Yes') return answered === true;
    if (option === 'No') return answered === false;
  }

  return false;
}

/**
 * Handle multi-select option click
 */
function handleMultiSelect(option, step) {
  const lowerOption = option.toLowerCase();

  if (step.id === 'dietary') {
    if (lowerOption === 'none') {
      state.dietaryPreferences = ['none'];
    } else if (state.dietaryPreferences.includes('none')) {
      state.dietaryPreferences = [lowerOption];
    } else {
      const idx = state.dietaryPreferences.indexOf(lowerOption);
      if (idx > -1) {
        state.dietaryPreferences.splice(idx, 1);
      } else {
        state.dietaryPreferences.push(lowerOption);
      }
    }
  }

  if (step.id === 'allergies') {
    const previousAllergies = [...state.avoidAllergens];
    
    if (lowerOption === 'none') {
      state.avoidAllergens = ['none'];
    } else if (state.avoidAllergens.includes('none')) {
      state.avoidAllergens = [lowerOption];
    } else {
      const idx = state.avoidAllergens.indexOf(lowerOption);
      if (idx > -1) {
        state.avoidAllergens.splice(idx, 1);
      } else {
        state.avoidAllergens.push(lowerOption);
      }
    }

    // Cleanup tolerance state for deselected allergies
    const deselectedAllergies = previousAllergies.filter(a => 
      a !== 'none' && !state.avoidAllergens.includes(a)
    );
    
    deselectedAllergies.forEach(allergen => {
      const config = allergyToleranceMap[allergen];
      if (config) {
        const flag = config.flag;
        
        // Remove tolerance answer
        delete state.tolerance_answers[allergen];
        
        // Remove flag from both arrays
        const tolerateIdx = state.tolerateFlags.indexOf(flag);
        if (tolerateIdx > -1) {
          state.tolerateFlags.splice(tolerateIdx, 1);
        }
        
        const avoidIdx = state.avoidIngredientFlags.indexOf(flag);
        if (avoidIdx > -1) {
          state.avoidIngredientFlags.splice(avoidIdx, 1);
        }
      }
    });
  }
}

/**
 * Handle single-select option click
 */
function handleSingleSelect(option, step) {
  if (step.id === 'crossContact') {
    state.crossContactOk = option === 'Yes';
  }

  if (step.id.startsWith('tolerance_')) {
    const allergen = step.allergen;
    const flag = step.flag;
    state.tolerance_answers[allergen] = option === 'Yes';

    if (option === 'Yes') {
      if (!state.tolerateFlags.includes(flag)) {
        state.tolerateFlags.push(flag);
      }
      // Remove from avoidIngredientFlags to avoid contradiction
      const avoidIdx = state.avoidIngredientFlags.indexOf(flag);
      if (avoidIdx > -1) {
        state.avoidIngredientFlags.splice(avoidIdx, 1);
      }
    } else {
      if (!state.avoidIngredientFlags.includes(flag)) {
        state.avoidIngredientFlags.push(flag);
      }
      // Remove from tolerateFlags to avoid contradiction
      const tolerateIdx = state.tolerateFlags.indexOf(flag);
      if (tolerateIdx > -1) {
        state.tolerateFlags.splice(tolerateIdx, 1);
      }
    }
  }
}

/**
 * Handle option button click
 */
function handleOptionClick(option) {
  const step = getCurrentStep();
  if (!step) return;

  if (step.mode === 'multi') {
    handleMultiSelect(option, step);
  } else {
    handleSingleSelect(option, step);
  }

  updateNextButton();
}

/**
 * Generate user-friendly summary of step selections
 */
function summarizeStep(step) {
  if (step.id === 'dietary') {
    if (state.dietaryPreferences.includes('none')) {
      return 'No dietary restrictions';
    }
    return 'Dietary: ' + state.dietaryPreferences.map(d => capitalize(d)).join(', ');
  }

  if (step.id === 'allergies') {
    if (state.avoidAllergens.includes('none')) {
      return 'No allergies';
    }
    return 'Allergies: ' + state.avoidAllergens.map(a => capitalize(a)).join(', ');
  }

  if (step.id === 'crossContact') {
    return 'Cross-contact: ' + (state.crossContactOk ? 'OK' : 'Not OK');
  }

  if (step.id.startsWith('tolerance_')) {
    const allergen = capitalize(step.allergen);
    const answer = state.tolerance_answers[step.allergen] ? 'Yes' : 'No';
    return allergen + ' tolerance: ' + answer;
  }

  return '';
}

/**
 * Capitalize first letter
 */
function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Move to next step
 */
function goNext() {
  const step = getCurrentStep();

  if (!isStepValid(step)) {
    return;
  }

  // Add user summary
  addUserMessage(summarizeStep(step));

  // Move to next step
  state.step++;

  // Check if conversation is complete
  if (state.step >= getTotalSteps()) {
    submitProfile();
  } else {
    const nextStep = getCurrentStep();
    addBotMessage(nextStep.question);
    renderOptions(nextStep.options, nextStep.mode);
    updateNextButton();
  }
}

/**
 * Move to previous step
 */
function goBack() {
  if (state.step === 0) return;

  state.step--;
  const previousStep = getCurrentStep();

  renderOptions(previousStep.options, previousStep.mode);
  updateNextButton();
}

/**
 * Update Next button disabled state
 */
function updateNextButton() {
  const step = getCurrentStep();
  const nextBtn = document.getElementById('nextBtn');

  if (!step) {
    nextBtn.disabled = true;
    return;
  }

  nextBtn.disabled = !isStepValid(step);
}

/**
 * Build final profile and submit to server
 */
function submitProfile() {
  const profile = {
    dietaryPreferences: state.dietaryPreferences.filter(d => d !== 'none'),
    avoidAllergens: state.avoidAllergens.filter(a => a !== 'none'),
    avoidIngredientFlags: state.avoidIngredientFlags,
    tolerateFlags: state.tolerateFlags,
    crossContactOk: state.crossContactOk
  };

  addUserMessage('Show me safe menu items');
  addBotMessage('Searching for safe menu items...');

  fetch('/api/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(profile)
  })
    .then(res => res.json())
    .then(data => displayResults(data))
    .catch(err => {
      addBotMessage('Error: ' + err.message);
    });
}

/**
 * Format modifications array into readable string
 */
function formatModifications(modifications) {
  if (!Array.isArray(modifications)) {
    return '';
  }

  const modStrings = modifications.map(mod => {
    if (mod.action && mod.ingredient) {
      return mod.action + ' ' + mod.ingredient;
    } else if (mod.notes) {
      return mod.notes;
    } else {
      return JSON.stringify(mod);
    }
  });

  return modStrings.join('; ');
}

/**
 * Display filtering results from server
 */
function displayResults(data) {
  let message = '';

  if (data.safeForAll && data.safeForAll.length > 0) {
    message += '<strong>Safe for all allergies:</strong>\n';
    data.safeForAll.forEach(item => {
      message += '• ' + item.name + '\n';
    });
  } else {
    message += '<strong>No items safe for all allergies.</strong>\n';
  }

  if (data.canBeModifiedForAll && data.canBeModifiedForAll.length > 0) {
    message += '\n<strong>Can be modified:</strong>\n';
    data.canBeModifiedForAll.forEach(item => {
      const modText = formatModifications(item.modifications);
      message += '• ' + item.name + ' (' + modText + ')\n';
    });
  }

  addBotMessage(message.trim());
}

/**
 * Add bot message to chat
 */
function addBotMessage(text) {
  const chatDiv = document.getElementById('chat');
  const msgDiv = document.createElement('div');
  msgDiv.className = 'msg bot';
  msgDiv.innerHTML = '<div class="bubble">' + text.replace(/\n/g, '<br>') + '</div>';
  chatDiv.appendChild(msgDiv);
  chatDiv.scrollTop = chatDiv.scrollHeight;
}

/**
 * Add user message to chat
 */
function addUserMessage(text) {
  const chatDiv = document.getElementById('chat');
  const msgDiv = document.createElement('div');
  msgDiv.className = 'msg user';
  msgDiv.innerHTML = '<div class="bubble">' + text + '</div>';
  chatDiv.appendChild(msgDiv);
  chatDiv.scrollTop = chatDiv.scrollHeight;
}

/**
 * Render option buttons
 */
function renderOptions(options, mode) {
  const optionsDiv = document.getElementById('options');
  optionsDiv.innerHTML = '';

  options.forEach(option => {
    const btn = document.createElement('button');
    btn.className = 'option-btn';
    btn.textContent = option;

    if (isOptionSelected(option)) {
      btn.classList.add('selected');
    }

    btn.addEventListener('click', () => {
      handleOptionClick(option);
      renderOptions(options, mode);
    });

    optionsDiv.appendChild(btn);
  });
}

// Event listeners
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('nextBtn').addEventListener('click', goNext);
  document.getElementById('backBtn').addEventListener('click', goBack);

  // Start conversation
  const firstStep = baseSteps[0];
  addBotMessage(firstStep.question);
  renderOptions(firstStep.options, firstStep.mode);
  updateNextButton();
});
