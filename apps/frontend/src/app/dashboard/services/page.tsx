/**
 * Tenant Dashboard — Service Management page.
 * CRUD interface for managing services across outlets.
 * Requirements: 3.2
 */
'use client';

import { useState, useEffect, useCallback } from 'react';

/** Service record displayed in the management list */
export interface Service {
  id: string;
  name: string;
  category: 'car_wash' | 'product' | 'addon';
  price: number;
  active: boolean;
  outletScope: 'all' | string[];
}

/** Props for ServiceForm dialog */
interface ServiceFormProps {
  service: Service | null;
  onSave: (data: Omit<Service, 'id'>) => void;
  onCancel: () => void;
}

function ServiceForm({ service, onSave, onCancel }: ServiceFormProps) {
  const [name, setName] = useState(service?.name ?? '');
  const [category, setCategory] = useState<Service['category']>(service?.category ?? 'car_wash');
  const [price, setPrice] = useState(service?.price?.toString() ?? '');
  const [active, setActive] = useState(service?.active ?? true);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({ name, category, price: Number(price), active, outletScope: 'all' });
  };

  return (
    <div data-testid="service-form-dialog" className="modal-overlay">
      <form onSubmit={handleSubmit} data-testid="service-form" className="modal-form">
        <h3>{service ? 'Edit Service' : 'Add Service'}</h3>
        <div>
          <label htmlFor="service-name">Name</label>
          <input
            id="service-name"
            data-testid="service-name-input"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>
        <div>
          <label htmlFor="service-category">Category</label>
          <select
            id="service-category"
            data-testid="service-category-select"
            value={category}
            onChange={(e) => setCategory(e.target.value as Service['category'])}
          >
            <option value="car_wash">Car Wash</option>
            <option value="product">Product</option>
            <option value="addon">Add-on</option>
          </select>
        </div>
        <div>
          <label htmlFor="service-price">Price</label>
          <input
            id="service-price"
            data-testid="service-price-input"
            type="number"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            min="0"
            required
          />
        </div>
        <div>
          <label htmlFor="service-active">
            <input
              id="service-active"
              data-testid="service-active-checkbox"
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
            />{' '}
            Active
          </label>
        </div>
        <div className="form-actions">
          <button type="button" data-testid="service-form-cancel" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" data-testid="service-form-save">
            {service ? 'Update' : 'Create'}
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * Service Management page for the Tenant Dashboard.
 * Lists all services with add, edit, delete, and toggle active/inactive actions.
 */
export default function ServicesPage() {
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingService, setEditingService] = useState<Service | null>(null);

  const fetchServices = useCallback(async () => {
    try {
      const res = await fetch('/api/services');
      if (!res.ok) throw new Error(`Failed to fetch services: ${res.status}`);
      const data: Service[] = await res.json();
      setServices(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch services');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchServices();
  }, [fetchServices]);

  const handleAdd = () => {
    setEditingService(null);
    setFormOpen(true);
  };

  const handleEdit = (service: Service) => {
    setEditingService(service);
    setFormOpen(true);
  };

  const handleSave = async (data: Omit<Service, 'id'>) => {
    try {
      if (editingService) {
        const res = await fetch(`/api/services/${editingService.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
        if (!res.ok) throw new Error('Failed to update service');
      } else {
        const res = await fetch('/api/services', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
        if (!res.ok) throw new Error('Failed to create service');
      }
      setFormOpen(false);
      setEditingService(null);
      await fetchServices();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    }
  };

  const handleDelete = async (serviceId: string) => {
    try {
      const res = await fetch(`/api/services/${serviceId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete service');
      await fetchServices();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const handleToggleActive = async (service: Service) => {
    try {
      const res = await fetch(`/api/services/${service.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...service, active: !service.active }),
      });
      if (!res.ok) throw new Error('Failed to toggle service status');
      await fetchServices();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Toggle failed');
    }
  };

  if (loading) {
    return (
      <div data-testid="services-loading">
        <p>Loading services...</p>
      </div>
    );
  }

  return (
    <div data-testid="services-page">
      <header className="page-header">
        <h1 data-testid="services-title">Manage Services</h1>
        <button data-testid="add-service-btn" onClick={handleAdd}>
          Add Service
        </button>
      </header>

      {error && (
        <div data-testid="services-error" className="error-banner">
          {error}
        </div>
      )}

      {services.length === 0 ? (
        <p data-testid="no-services">No services found. Add one to get started.</p>
      ) : (
        <table data-testid="services-table" className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Category</th>
              <th>Price</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {services.map((service) => (
              <tr key={service.id} data-testid={`service-row-${service.id}`}>
                <td>{service.name}</td>
                <td>{service.category}</td>
                <td>{service.price.toLocaleString('id-ID')}</td>
                <td>
                  <span data-testid={`service-status-${service.id}`}>
                    {service.active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td>
                  <button
                    data-testid={`edit-service-${service.id}`}
                    onClick={() => handleEdit(service)}
                  >
                    Edit
                  </button>
                  <button
                    data-testid={`toggle-service-${service.id}`}
                    onClick={() => handleToggleActive(service)}
                  >
                    {service.active ? 'Deactivate' : 'Activate'}
                  </button>
                  <button
                    data-testid={`delete-service-${service.id}`}
                    onClick={() => handleDelete(service.id)}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {formOpen && (
        <ServiceForm
          service={editingService}
          onSave={handleSave}
          onCancel={() => {
            setFormOpen(false);
            setEditingService(null);
          }}
        />
      )}
    </div>
  );
}
