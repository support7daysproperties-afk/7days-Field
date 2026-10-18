import React, { useState, useMemo } from 'react';
import { Plus, Trash2, X, PlusCircle } from 'lucide-react';
import { useBackHandler } from '../hooks/useBackHandler';

export default function FieldChecklistStep({
  checklist = {},
  setChecklist,
  customChecklistItems = [],
  setCustomChecklistItems,
  checklistReviewed = false,
  setChecklistReviewed,
  onContinue
}) {
  const [addingCategory, setAddingCategory] = useState(null);
  const [categoryItemInput, setCategoryItemInput] = useState('');
  const [categoryItemError, setCategoryItemError] = useState('');

  const [showAddCustomCategoryModal, setShowAddCustomCategoryModal] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryItemName, setNewCategoryItemName] = useState('');
  const [customCategoryError, setCustomCategoryError] = useState('');

  // Hardware/System back button dismisses the custom category modal if open
  useBackHandler('insp_custom_cat_modal', () => {
    setShowAddCustomCategoryModal(false);
    return true;
  }, 110, showAddCustomCategoryModal);

  const checklistGroups = useMemo(() => {
    const baseGroups = [
      { title: 'Property Access', items: ['Road accessible', 'Vehicle access available', 'Entrance identified'] },
      { title: 'Property Condition', items: ['Exterior inspected', 'Interior inspected', 'Boundary inspected'] },
      { title: 'Documentation', items: ['Documents reviewed', 'Owner information confirmed'] }
    ];

    const customByCategory = {};
    (customChecklistItems || []).forEach(ci => {
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

    return result;
  }, [customChecklistItems]);

  const handleQuickAddCategoryItem = (categoryTitle) => {
    const trimmed = categoryItemInput.trim();
    if (!trimmed) {
      setCategoryItemError('Please enter a check description.');
      return;
    }
    if (checklist && checklist[trimmed] !== undefined) {
      setCategoryItemError('A check with this description already exists.');
      return;
    }

    const newItem = {
      id: `custom_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: trimmed,
      category: categoryTitle
    };

    setCustomChecklistItems(prev => [...(prev || []), newItem]);
    setChecklist(prev => ({
      ...(prev || {}),
      [trimmed]: false
    }));
    setCategoryItemInput('');
    setAddingCategory(null);
    setCategoryItemError('');
  };

  const handleCreateCustomCategory = () => {
    const trimmedCat = newCategoryName.trim();
    const trimmedItem = newCategoryItemName.trim();
    if (!trimmedCat) {
      setCustomCategoryError('Please enter a category name.');
      return;
    }
    if (!trimmedItem) {
      setCustomCategoryError('Please enter a check description.');
      return;
    }
    if (checklist && checklist[trimmedItem] !== undefined) {
      setCustomCategoryError('A check with this description already exists.');
      return;
    }

    const newItem = {
      id: `custom_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: trimmedItem,
      category: trimmedCat
    };

    setCustomChecklistItems(prev => [...(prev || []), newItem]);
    setChecklist(prev => ({
      ...(prev || {}),
      [trimmedItem]: false
    }));
    setNewCategoryName('');
    setNewCategoryItemName('');
    setShowAddCustomCategoryModal(false);
    setCustomCategoryError('');
  };

  const handleDeleteCategory = (categoryTitle) => {
    const itemsToDelete = (customChecklistItems || [])
      .filter(ci => ci.category === categoryTitle)
      .map(ci => ci.name);

    setCustomChecklistItems(prev => (prev || []).filter(ci => ci.category !== categoryTitle));
    setChecklist(prev => {
      const next = { ...(prev || {}) };
      itemsToDelete.forEach(name => {
        delete next[name];
      });
      return next;
    });
  };

  const handleDeleteCustomCheckItem = (itemNameToDelete) => {
    setCustomChecklistItems(prev => (prev || []).filter(ci => ci.name !== itemNameToDelete));
    setChecklist(prev => {
      const next = { ...(prev || {}) };
      delete next[itemNameToDelete];
      return next;
    });
  };

  const safeChecklist = checklist || {};
  const checklistCompleted = Object.values(safeChecklist).filter(Boolean).length;
  const checklistTotal = Object.keys(safeChecklist).length;

  return (
    <div className="card">
      <div className="flex justify-between items-center mb-md">
        <h3 className="m-0">Inspection Checklist</h3>
        <span className="badge badge-primary">{checklistCompleted} / {checklistTotal}</span>
      </div>
      
      <div className="progress-bar mb-md">
        <div className="progress-fill" style={{ width: `${checklistTotal > 0 ? (checklistCompleted / checklistTotal) * 100 : 0}%` }}></div>
      </div>

      <div className="flex flex-col gap-md">
        {checklistGroups.map(group => {
          const isCustomGroup = !['Property Access', 'Property Condition', 'Documentation'].includes(group.title);
          const isAddingHere = addingCategory === group.title;

          return (
            <div key={group.title}>
              <div className="flex justify-between items-center mb-sm">
                <h4 className="text-sm text-secondary uppercase font-semibold m-0">{group.title}</h4>
                <div className="flex items-center gap-xs">
                  <button
                    type="button"
                    onClick={() => {
                      if (isAddingHere) {
                        setAddingCategory(null);
                        setCategoryItemInput('');
                        setCategoryItemError('');
                      } else {
                        setAddingCategory(group.title);
                        setCategoryItemInput('');
                        setCategoryItemError('');
                      }
                    }}
                    className="text-xs font-semibold flex items-center gap-xs"
                    style={{
                      background: isAddingHere ? 'var(--primary-color)' : 'rgba(37, 99, 235, 0.12)',
                      border: '1px solid rgba(59, 130, 246, 0.3)',
                      color: isAddingHere ? '#ffffff' : '#60a5fa',
                      cursor: 'pointer',
                      padding: '3px 8px',
                      borderRadius: '6px',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <Plus size={12} strokeWidth={2.5} /> Add
                  </button>
                  {isCustomGroup && (
                    <button
                      type="button"
                      onClick={() => handleDeleteCategory(group.title)}
                      title={`Delete category "${group.title}"`}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#ef4444',
                        cursor: 'pointer',
                        padding: '3px 4px',
                        display: 'flex',
                        alignItems: 'center',
                        opacity: 0.8
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
                      onMouseLeave={(e) => (e.currentTarget.style.opacity = '0.8')}
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              </div>

              {/* Inline input for this specific category */}
              {isAddingHere && (
                <div 
                  className="animate-fade-in"
                  style={{
                    backgroundColor: 'var(--surface-light)',
                    border: '1px solid rgba(59, 130, 246, 0.35)',
                    borderRadius: '8px',
                    padding: '8px 10px',
                    marginBottom: '8px'
                  }}
                >
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center', width: '100%' }}>
                    <input 
                      type="text" 
                      className="form-input" 
                      placeholder={`Add check to ${group.title}...`}
                      value={categoryItemInput}
                      onChange={(e) => {
                        setCategoryItemInput(e.target.value);
                        if (categoryItemError) setCategoryItemError('');
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleQuickAddCategoryItem(group.title);
                        }
                      }}
                      autoFocus
                      style={{ 
                        flex: 1, 
                        minWidth: 0, 
                        width: '100%', 
                        padding: '8px 12px', 
                        fontSize: '13px', 
                        margin: 0,
                        backgroundColor: 'var(--surface-color, #0f172a)',
                        color: 'var(--text-primary, #ffffff)',
                        border: '1px solid var(--border-color, #334155)',
                        borderRadius: '6px',
                        outline: 'none',
                        boxSizing: 'border-box'
                      }}
                    />
                    <button 
                      type="button" 
                      className="btn btn-primary"
                      onClick={() => handleQuickAddCategoryItem(group.title)}
                      disabled={!categoryItemInput.trim()}
                      style={{ 
                        width: 'auto',
                        flex: '0 0 auto',
                        padding: '8px 16px', 
                        fontSize: '12px', 
                        fontWeight: 600, 
                        height: 'auto', 
                        minHeight: 'unset', 
                        whiteSpace: 'nowrap',
                        borderRadius: '6px',
                        opacity: !categoryItemInput.trim() ? 0.5 : 1,
                        cursor: !categoryItemInput.trim() ? 'not-allowed' : 'pointer'
                      }}
                    >
                      Add
                    </button>
                    <button 
                      type="button" 
                      onClick={() => {
                        setAddingCategory(null);
                        setCategoryItemInput('');
                        setCategoryItemError('');
                      }}
                      style={{ 
                        background: 'none', 
                        border: 'none', 
                        color: 'var(--text-secondary)', 
                        cursor: 'pointer', 
                        padding: '6px', 
                        display: 'flex', 
                        alignItems: 'center', 
                        justifyContent: 'center',
                        flex: '0 0 auto',
                        borderRadius: '4px'
                      }}
                      aria-label="Cancel"
                    >
                      <X size={16} />
                    </button>
                  </div>
                  {categoryItemError && (
                    <span className="text-danger text-xs" style={{ display: 'block', marginTop: '4px' }}>
                      {categoryItemError}
                    </span>
                  )}
                </div>
              )}

              <div className="flex flex-col gap-xs">
                {group.items.map(item => {
                  const isCustom = (customChecklistItems || []).some(ci => ci.name === item);
                  return (
                    <div 
                      key={item} 
                      className="checkbox-container" 
                      onClick={() => setChecklist(prev => ({ ...(prev || {}), [item]: !(prev && prev[item]) }))}
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingRight: '12px' }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1, minWidth: 0 }}>
                        <input type="checkbox" checked={!!safeChecklist[item]} readOnly style={{ pointerEvents: 'none' }} />
                        <span className="text-sm" style={{ wordBreak: 'break-word' }}>{item}</span>
                        {isCustom && (
                          <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '4px', backgroundColor: 'rgba(59, 130, 246, 0.15)', color: '#60a5fa', fontWeight: 600, border: '1px solid rgba(59, 130, 246, 0.3)' }}>
                            Custom
                          </span>
                        )}
                      </div>
                      {isCustom && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteCustomCheckItem(item);
                          }}
                          title="Delete custom check"
                          style={{
                            background: 'none',
                            border: 'none',
                            color: '#ef4444',
                            cursor: 'pointer',
                            padding: '4px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            borderRadius: '4px',
                            opacity: 0.8
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
                          onMouseLeave={(e) => (e.currentTarget.style.opacity = '0.8')}
                        >
                          <Trash2 size={15} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Bottom section for creating a new custom category */}
      {showAddCustomCategoryModal && (
        <div 
          className="animate-fade-in"
          style={{
            backgroundColor: 'var(--surface-light)',
            border: '1.5px solid rgba(59, 130, 246, 0.4)',
            borderRadius: '12px',
            padding: '16px',
            marginTop: '16px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.2)'
          }}
        >
          <div className="flex justify-between items-center mb-sm">
            <h4 className="text-sm font-bold flex items-center gap-xs" style={{ margin: 0, color: '#60a5fa' }}>
              <PlusCircle size={16} /> Create Custom Category & Check
            </h4>
            <button 
              type="button"
              onClick={() => {
                setShowAddCustomCategoryModal(false);
                setNewCategoryName('');
                setNewCategoryItemName('');
                setCustomCategoryError('');
              }}
              style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: '4px' }}
              aria-label="Close"
            >
              <X size={18} />
            </button>
          </div>

          <div style={{ marginBottom: '12px' }}>
            <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '6px', fontWeight: 500 }}>
              Category Name
            </label>
            <input 
              type="text" 
              className="form-input" 
              placeholder="e.g. Electricity, Water Supply, Security..."
              value={newCategoryName}
              onChange={(e) => {
                setNewCategoryName(e.target.value);
                if (customCategoryError) setCustomCategoryError('');
              }}
              autoFocus
              style={{ fontSize: '13px', width: '100%', boxSizing: 'border-box' }}
            />
          </div>

          <div style={{ marginBottom: '14px' }}>
            <label style={{ display: 'block', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '6px', fontWeight: 500 }}>
              Initial Check Item Description
            </label>
            <input 
              type="text" 
              className="form-input" 
              placeholder="e.g. 24/7 Current, Meter reading verified..."
              value={newCategoryItemName}
              onChange={(e) => {
                setNewCategoryItemName(e.target.value);
                if (customCategoryError) setCustomCategoryError('');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleCreateCustomCategory();
                }
              }}
              style={{ fontSize: '13px', width: '100%', boxSizing: 'border-box' }}
            />
            {customCategoryError && (
              <span className="text-danger text-xs" style={{ display: 'block', marginTop: '4px' }}>
                {customCategoryError}
              </span>
            )}
          </div>

          <div className="flex gap-sm">
            <button 
              type="button"
              className="btn btn-secondary flex-1"
              onClick={() => {
                setShowAddCustomCategoryModal(false);
                setNewCategoryName('');
                setNewCategoryItemName('');
                setCustomCategoryError('');
              }}
              style={{ padding: '8px 12px', fontSize: '13px' }}
            >
              Cancel
            </button>
            <button 
              type="button"
              className="btn btn-primary flex-1"
              onClick={handleCreateCustomCategory}
              disabled={!newCategoryName.trim() || !newCategoryItemName.trim()}
              style={{ padding: '8px 12px', fontSize: '13px', fontWeight: 700 }}
            >
              Create Category
            </button>
          </div>
        </div>
      )}

      {!showAddCustomCategoryModal && (
        <button 
          type="button"
          onClick={() => {
            setShowAddCustomCategoryModal(true);
            setNewCategoryName('');
            setNewCategoryItemName('');
            setCustomCategoryError('');
          }}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            padding: '12px',
            marginTop: '16px',
            backgroundColor: 'rgba(37, 99, 235, 0.05)',
            border: '1.5px dashed rgba(59, 130, 246, 0.4)',
            borderRadius: '10px',
            color: '#60a5fa',
            fontSize: '13px',
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'all 0.15s ease'
          }}
        >
          <Plus size={16} strokeWidth={2.5} /> Add Custom Category
        </button>
      )}

      <button 
        className="btn btn-primary mt-lg" 
        onClick={() => {
          if (setChecklistReviewed) setChecklistReviewed(true);
          if (onContinue) onContinue();
        }}
      >
        Continue to Remarks
      </button>
    </div>
  );
}
