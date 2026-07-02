import { useState, useEffect, useRef } from 'react';
import client from '../api/client';

export default function WorkerSearch({ onSelect, selectedWorker }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef(null);
  const debounceRef = useRef(null);

  useEffect(() => {
    if (selectedWorker) {
      setQuery(`${selectedWorker.firstName} ${selectedWorker.lastName}`);
    }
  }, [selectedWorker]);

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
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    if (!query.trim()) {
      setResults([]);
      setIsOpen(false);
      if (selectedWorker) {
        onSelect(null);
      }
      return;
    }

    if (
      selectedWorker &&
      query === `${selectedWorker.firstName} ${selectedWorker.lastName}`
    ) {
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      setIsOpen(true);
      try {
        const response = await client.get('/api/workers', {
          params: { search: query.trim() },
        });
        setResults(response.data);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, onSelect, selectedWorker]);

  function handleSelect(worker) {
    onSelect(worker);
    setQuery(`${worker.firstName} ${worker.lastName}`);
    setIsOpen(false);
  }

  function handleInputChange(event) {
    const value = event.target.value;
    setQuery(value);
    if (!value.trim() && selectedWorker) {
      onSelect(null);
    }
  }

  return (
    <div className="worker-search" ref={containerRef}>
      <input
        id="worker-search"
        type="text"
        className="form-input"
        placeholder="Search by name…"
        value={query}
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
                {worker.firstName} {worker.lastName} — #{worker.employeeCode || '—'}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
