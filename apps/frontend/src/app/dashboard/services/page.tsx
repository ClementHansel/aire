'use client';

import { useState } from 'react';

interface Service {
  id: string;
  name: string;
  category: 'car_wash' | 'product' | 'addon';
  price: number;
  active: boolean;
}

const DEMO_SERVICES: Service[] = [
  { id: '1', name: 'Express Wash', category: 'car_wash', price: 35000, active: true },
  { id: '2', name: 'Premium Wash + Wax', category: 'car_wash', price: 75000, active: true },
  { id: '3', name: 'Interior Detail', category: 'addon', price: 50000, active: true },
  { id: '4', name: 'Air Freshener', category: 'product', price: 15000, active: false },
  { id: '5', name: 'Engine Clean', category: 'addon', price: 100000, active: true },
];

const CATEGORY_LABELS: Record<string, string> = {
  car_wash: 'Car Wash',
  product: 'Product',
  addon: 'Add-on',
};

export default function ServicesPage() {
  const [services] = useState<Service[]>(DEMO_SERVICES);

  return (
    <div data-testid="services-page">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-text-primary" data-testid="services-title">Services</h1>
          <p className="mt-1 text-sm text-text-secondary">Manage your service menu and pricing.</p>
        </div>
        <button className="btn-primary" data-testid="add-service-btn">+ Add Service</button>
      </div>

      <div className="card overflow-hidden p-0">
        <table className="w-full" data-testid="services-table">
          <thead>
            <tr className="border-b border-border bg-surface-sunken/50">
              <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase tracking-wide">Name</th>
              <th className="text-left px-5 py-3 text-xs font-medium text-text-secondary uppercase tracking-wide">Category</th>
              <th className="text-right px-5 py-3 text-xs font-medium text-text-secondary uppercase tracking-wide">Price</th>
              <th className="text-center px-5 py-3 text-xs font-medium text-text-secondary uppercase tracking-wide">Status</th>
              <th className="text-right px-5 py-3 text-xs font-medium text-text-secondary uppercase tracking-wide">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {services.map((service) => (
              <tr key={service.id} className="hover:bg-surface-sunken/30 transition-colors" data-testid={`service-row-${service.id}`}>
                <td className="px-5 py-3.5 text-sm font-medium text-text-primary">{service.name}</td>
                <td className="px-5 py-3.5">
                  <span className="badge bg-primary-50 text-primary-700">{CATEGORY_LABELS[service.category]}</span>
                </td>
                <td className="px-5 py-3.5 text-sm text-text-primary text-right font-mono">
                  Rp {service.price.toLocaleString('id-ID')}
                </td>
                <td className="px-5 py-3.5 text-center">
                  <span className={`badge ${service.active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                    {service.active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className="px-5 py-3.5 text-right">
                  <button className="btn-ghost text-xs">Edit</button>
                  <button className="btn-ghost text-xs text-error">Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
