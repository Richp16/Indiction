import { useState, useEffect, useMemo, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { apiGet } from '../api/client';

function workerLabel(worker) {
  if (!worker) return '';
  const name = `${worker.firstName || ''} ${worker.lastName || ''}`.trim();
  return worker.employeeCode ? `${name} — #${worker.employeeCode}` : name;
}

export default function WorkerSearch({
  onSelect,
  selectedWorker,
  multiSelect = false,
  selectedWorkers = [],
  onChange,
  disabled = false,
}) {
  const { token } = useAuth();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [allWorkers, setAllWorkers] = useState([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef(null);
  const debounceRef = useRef(null);

  const selectedIds = useMemo(
    () => new Set((selectedWorkers || []).map((worker) => String(worker.id))),
    [selectedWorkers]
  );

  useEffect(() => {
    if (multiSelect || selectedWorker) return;
    setQuery('');
  }, [multiSelect, selectedWorker]);

  useEffect(() => {
    if (!multiSelect && selectedWorker) {
      setQuery(`${selectedWorker.firstName} ${selectedWorker.lastName}`);
    }
  }, [multiSelect, selectedWorker]);

  useEffect(() => {
    function handleClickOutside(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!multiSelect || !token) return undefined;
    let cancelled = false;
    async function loadWorkers() {
      setLoading(true);
      try {
        const workers = await apiGet('/api/workers', token);
        const activePaid = (workers || []).filter(
          (worker) => worker.isActive !== false && worker.standardRate != null
        );
        if (!cancelled) setAllWorkers(activePaid);
      } catch {
        if (!cancelled) setAllWorkers([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadWorkers();
    return () => {
      cancelled = true;
    };
  }, [multiSelect, token]);

  const filteredWorkers = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return allWorkers;
    return allWorkers.filter((worker) => {
      const haystack = `${worker.firstName || ''} ${worker.lastName || ''} ${worker.employeeCode || ''}`.toLowerCase();
      return haystack.includes(term);
    });
  }, [allWorkers, query]);

  useEffect(() => {
    if (multiSelect) return undefined;
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    if (!query.trim()) {
      setResults([]);
      setIsOpen(false);
      if (selectedWorker && onSelect) {
        onSelect(null);
      }
      return undefined;
    }

    if (
      selectedWorker &&
      query === `${selectedWorker.firstName} ${selectedWorker.lastName}`
    ) {
      return undefined;
    }

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      setIsOpen(true);
      try {
        const workers = await apiGet(
          `/api/workers?search=${encodeURIComponent(query.trim())}`,
          token
        );
        setResults(
          (workers || []).filter(
            (worker) => worker.isActive !== false && worker.standardRate != null
          )
        );
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, onSelect, selectedWorker, token, multiSelect]);

  function handleSelect(worker) {
    if (onSelect) onSelect(worker);
    setQuery(`${worker.firstName} ${worker.lastName}`);
    setIsOpen(false);
  }

  function toggleWorker(worker) {
    if (!onChange) return;
    const exists = selectedIds.has(String(worker.id));
    if (exists) {
      onChange(selectedWorkers.filter((item) => String(item.id) !== String(worker.id)));
    } else {
      onChange([...selectedWorkers, worker]);
    }
  }

  function toggleFiltered() {
    if (!onChange) return;
    const filteredIds = new Set(filteredWorkers.map((worker) => String(worker.id)));
    const allSelected =
      filteredWorkers.length > 0 &&
      filteredWorkers.every((worker) => selectedIds.has(String(worker.id)));
    if (allSelected) {
      onChange(selectedWorkers.filter((worker) => !filteredIds.has(String(worker.id))));
    } else {
      const merged = [...selectedWorkers];
      for (const worker of filteredWorkers) {
        if (!selectedIds.has(String(worker.id))) merged.push(worker);
      }
      onChange(merged);
    }
  }

  function handleInputChange(event) {
    const value = event.target.value;
    setQuery(value);
    if (!multiSelect && !value.trim() && selectedWorker && onSelect) {
      onSelect(null);
    }
  }

  if (multiSelect) {
    const filteredAllSelected =
      filteredWorkers.length > 0 &&
      filteredWorkers.every((worker) => selectedIds.has(String(worker.id)));
    return (
      <div className="worker-search worker-search--multi">
        <input
          id="worker-search"
          type="text"
          className="form-input"
          placeholder="Filter workers by name…"
          value={query}
          disabled={disabled}
          onChange={handleInputChange}
          autoComplete="off"
        />
        <div className="worker-multi-toolbar">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={disabled || filteredWorkers.length === 0}
            onClick={toggleFiltered}
          >
            {filteredAllSelected ? 'Clear filtered' : 'Select filtered'}
          </button>
          <span className="form-hint">
            {selectedWorkers.length} selected
            {query.trim() ? ` · ${filteredWorkers.length} shown` : ''}
          </span>
        </div>
        <div className="worker-multi-list" role="group" aria-label="Workers">
          {loading && <div className="worker-search-loading">Loading workers…</div>}
          {!loading && filteredWorkers.length === 0 && (
            <div className="worker-search-empty">No workers found</div>
          )}
          {!loading &&
            filteredWorkers.map((worker) => {
              const checked = selectedIds.has(String(worker.id));
              return (
                <label key={worker.id} className="worker-multi-item">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={disabled}
                    onChange={() => toggleWorker(worker)}
                  />
                  <span>{workerLabel(worker)}</span>
                </label>
              );
            })}
        </div>
      </div>
    );
  }

  return (
    <div className="worker-search" ref={containerRef}>
      <input
        id="worker-search"
        type="text"
        className="form-input"
        placeholder="Search by name…"
        value={query}
        disabled={disabled}
        onChange={handleInputChange}
        onFocus={() => {
          if (query.trim() && results.length > 0) setIsOpen(true);
        }}
        autoComplete="off"
      />
      {isOpen && (
        <div className="worker-search-dropdown">
          {loading && (
            <div className="worker-search-loading">
              <span className="spinner" /> Searching…
            </div>
          )}
          {!loading && results.length === 0 && (
            <div className="worker-search-empty">No workers found</div>
          )}
          {!loading &&
            results.map((worker) => (
              <button
                key={worker.id}
                type="button"
                className="worker-search-item"
                onClick={() => handleSelect(worker)}
              >
                {workerLabel(worker)}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
