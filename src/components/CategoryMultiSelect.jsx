import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import '../styles/category-multi-select.css';

export default function CategoryMultiSelect({ categories = [], selected = [], onChange, label = 'Product category', allLabel = 'All Categories', portalMenu = false }) {
    const [open, setOpen] = useState(false);
    const [menuStyle, setMenuStyle] = useState(null);
    const rootRef = useRef(null);
    const menuRef = useRef(null);
    const menuId = useId();
    const options = categories.map(item => typeof item === 'string' ? { value: item, label: item } : item);
    const optionLabels = new Map(options.map(item => [item.value, item.label]));
    const allOptionValues = [...new Set(options.map(item => item.value))];
    const allExplicitlySelected = allOptionValues.length > 0 && allOptionValues.every(value => selected.includes(value));
    const selectionNoun = label.toLowerCase().includes('province') ? 'provinces' : 'categories';
    const selectedLabel = selected.length === 0
        ? allLabel
        : selected.length === 1
            ? optionLabels.get(selected[0]) || selected[0]
            : `${selected.length} ${selectionNoun}`;

    useEffect(() => {
        if (!open) return undefined;
        const updateMenuPosition = () => {
            const trigger = rootRef.current?.querySelector('.category-multi-select-trigger');
            if (!trigger) return;
            const rect = trigger.getBoundingClientRect();
            const margin = 12;
            const below = window.innerHeight - rect.bottom - margin;
            const above = rect.top - margin;
            const placeAbove = below < 150 && above > below;
            const maxHeight = Math.max(80, Math.min(270, placeAbove ? above : below));
            const width = Math.min(Math.max(rect.width, 240), window.innerWidth - margin * 2);
            const left = Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin));
            setMenuStyle({
                position: 'fixed',
                zIndex: 1101,
                left,
                width,
                maxHeight,
                ...(placeAbove
                    ? { top: 'auto', bottom: window.innerHeight - rect.top + 5 }
                    : { top: rect.bottom + 5, bottom: 'auto' }),
            });
        };
        if (portalMenu) updateMenuPosition();
        const closeOutside = event => {
            if (!rootRef.current?.contains(event.target) && !menuRef.current?.contains(event.target)) setOpen(false);
        };
        const closeEscape = event => {
            if (event.key === 'Escape') setOpen(false);
        };
        document.addEventListener('pointerdown', closeOutside);
        document.addEventListener('keydown', closeEscape);
        if (portalMenu) {
            window.addEventListener('resize', updateMenuPosition);
            window.addEventListener('scroll', updateMenuPosition, true);
        }
        return () => {
            document.removeEventListener('pointerdown', closeOutside);
            document.removeEventListener('keydown', closeEscape);
            if (portalMenu) {
                window.removeEventListener('resize', updateMenuPosition);
                window.removeEventListener('scroll', updateMenuPosition, true);
            }
        };
    }, [open, portalMenu]);

    function toggleCategory(category) {
        onChange(selected.includes(category)
            ? selected.filter(value => value !== category)
            : [...selected, category]);
    }

    const menu = open && (
        <fieldset
            ref={menuRef}
            className="category-multi-select-menu"
            id={menuId}
            aria-label={label}
            style={portalMenu ? menuStyle || { visibility: 'hidden' } : undefined}
        >
            <label className="category-multi-select-option all">
                <input type="checkbox" checked={selected.length === 0} onChange={() => onChange([])} />
                <span>{allLabel}</span>
            </label>
            <label className="category-multi-select-option select-all">
                <input type="checkbox" checked={allExplicitlySelected} disabled={!allOptionValues.length}
                    onChange={() => onChange(allExplicitlySelected ? [] : allOptionValues)} />
                <span>{allExplicitlySelected ? `Deselect all ${selectionNoun}` : `Select all ${selectionNoun}`}</span>
            </label>
            <div className="category-multi-select-divider" />
            {options.map(option => (
                <label className="category-multi-select-option" key={option.value}>
                    <input type="checkbox" checked={selected.includes(option.value)} onChange={() => toggleCategory(option.value)} />
                    <span>{option.label}</span>
                </label>
            ))}
            {!categories.length && <p className="category-multi-select-empty">No categories are available in this scope.</p>}
        </fieldset>
    );

    return (
        <div className="category-multi-select rd-field" ref={rootRef}>
            <span>{label}</span>
            <button
                type="button"
                className="category-multi-select-trigger"
                aria-expanded={open}
                aria-controls={menuId}
                title={selectedLabel}
                onClick={() => setOpen(value => !value)}
            >
                <strong>{selectedLabel}</strong>
                <span className="category-multi-select-caret" aria-hidden="true">{open ? '▲' : '▼'}</span>
            </button>
            {portalMenu ? (menu && menuStyle && createPortal(menu, document.body)) : menu}
        </div>
    );
}
