'use client';

// The barcode label designer now lives as a tab inside the Barcode settings page
// (shown only while barcodes are enabled). Kept as a redirect so old links don't 404.
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function BarcodeLabelDesignerRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/dashboard/barcode-settings?tab=designer'); }, [router]);
  return null;
}
