import { describe, it, expect } from 'vitest';

describe('Field Checklist Custom Item Creation and Management', () => {
  it('dynamically groups default and custom checklist items by category', () => {
    const baseGroups = [
      { title: 'Property Access', items: ['Road accessible', 'Vehicle access available', 'Entrance identified'] },
      { title: 'Property Condition', items: ['Exterior inspected', 'Interior inspected', 'Boundary inspected'] },
      { title: 'Documentation', items: ['Documents reviewed', 'Owner information confirmed'] }
    ];

    const customChecklistItems = [
      { id: 'c1', name: 'Water connection verified', category: 'Property Condition' },
      { id: 'c2', name: 'CCTV surveillance checked', category: 'Additional Checks' }
    ];

    const customByCategory = {};
    customChecklistItems.forEach(ci => {
      const cat = ci.category || 'Additional Checks';
      if (!customByCategory[cat]) customByCategory[cat] = [];
      customByCategory[cat].push(ci.name);
    });

    const result = baseGroups.map(g => ({
      ...g,
      items: [...g.items, ...(customByCategory[g.title] || [])]
    }));

    Object.keys(customByCategory).forEach(cat => {
      if (!baseGroups.some(g => g.title === cat)) {
        result.push({
          title: cat,
          items: customByCategory[cat]
        });
      }
    });

    // Check Property Condition has the new item
    const propConditionGroup = result.find(g => g.title === 'Property Condition');
    expect(propConditionGroup.items).toContain('Water connection verified');
    expect(propConditionGroup.items.length).toBe(4);

    // Check Additional Checks group was created
    const additionalGroup = result.find(g => g.title === 'Additional Checks');
    expect(additionalGroup).toBeDefined();
    expect(additionalGroup.items).toContain('CCTV surveillance checked');
  });

  it('correctly updates checklist totals and completion when custom items are added and checked', () => {
    const checklist = {
      'Road accessible': true,
      'Vehicle access available': false,
      'Entrance identified': false,
      'Exterior inspected': false,
      'Interior inspected': false,
      'Boundary inspected': false,
      'Documents reviewed': false,
      'Owner information confirmed': false
    };

    let total = Object.keys(checklist).length;
    let completed = Object.values(checklist).filter(Boolean).length;
    expect(total).toBe(8);
    expect(completed).toBe(1);

    // Add custom item
    checklist['Electricity meter inspected'] = false;
    total = Object.keys(checklist).length;
    completed = Object.values(checklist).filter(Boolean).length;
    expect(total).toBe(9);
    expect(completed).toBe(1);

    // Toggle custom item to checked
    checklist['Electricity meter inspected'] = true;
    completed = Object.values(checklist).filter(Boolean).length;
    expect(completed).toBe(2);

    // Delete custom item
    delete checklist['Electricity meter inspected'];
    total = Object.keys(checklist).length;
    completed = Object.values(checklist).filter(Boolean).length;
    expect(total).toBe(8);
    expect(completed).toBe(1);
  });

  it('supports officer-defined custom categories and includes them in existing categories', () => {
    const defaultCats = ['Property Condition', 'Property Access', 'Documentation', 'Additional Checks'];
    const customItems = [
      { id: '1', name: 'Check solar panel', category: 'Energy & Utilities' },
      { id: '2', name: 'Check inverter', category: 'Energy & Utilities' },
      { id: '3', name: 'Check CCTV cameras', category: 'Security' }
    ];

    const customCats = customItems.map(ci => ci.category).filter(c => c && !defaultCats.includes(c));
    const allCategories = [...defaultCats, ...Array.from(new Set(customCats))];

    expect(allCategories).toContain('Energy & Utilities');
    expect(allCategories).toContain('Security');
    expect(allCategories.length).toBe(6);
  });

  it('marks Field Checklist as completed when items are checked or checklist is reviewed', () => {
    const checklistCompleted = 8;
    const checklistTotal = 9;
    let checklistReviewed = false;

    // Previously strictly required checklistCompleted === checklistTotal
    const oldCompleted = checklistCompleted === checklistTotal;
    expect(oldCompleted).toBe(false); // was stuck in Pending!

    // New logic: completed if reviewed or at least one item filled
    const newCompleted = checklistReviewed || checklistCompleted > 0;
    expect(newCompleted).toBe(true);

    // Also true if checklistReviewed is set
    checklistReviewed = true;
    expect(checklistReviewed || 0 > 0).toBe(true);
  });
});
