import { useState, useEffect } from 'react';
import client from '../api/client';

export default function PayCodeSelect({ workerId, onSelect, disabled }) {
  const [components, setComponents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedValue, setSelectedValue] = useState('');

  useEffect(() => {
    setSelectedValue('');
    onSelect(null);

    if (!workerId) {
      setComponents([]);
      return;
    }

    let cancelled = false;

    async function fetchComponents() {
      setLoading(true);
      try {
        const response = await client.get(`/api/workers/${workerId}/pay-components`);
        if (!cancelled) {
          setComponents(response.data);
        }
      } catch {
        if (!cancelled) setComponents([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchComponents();
    return () => {
      cancelled = true;
    };
  }, [workerId]);

  function handleChange(event) {
    const value = event.target.value;
    setSelectedValue(value);
    if (!value) {
      onSelect(null);
      return;
    }
    onSelect(JSON.parse(value));
  }

  const isDisabled = disabled || !workerId || loading;

  return (
    <select
      id="pay-code"
      className="form-select"
      value={selectedValue}
      onChange={handleChange}
      disabled={isDisabled}
    >
      <option value="">Select pay code…</option>
      {components.map((component) => {
        const optionValue = JSON.stringify({
          paychexComponentId: component.paychexComponentId,
          name: component.name,
          rate: component.rate,
        });
        const rateLabel =
          component.rate != null ? `$${Number(component.rate).toFixed(2)}/hr` : '—';
        return (
          <option key={component.paychexComponentId} value={optionValue}>
            {component.name} — {rateLabel}
          </option>
        );
      })}
    </select>
  );
}
