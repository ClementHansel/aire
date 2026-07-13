'use client';

import { cn } from '@/lib/utils';
import { useBranding } from '@/contexts/BrandingContext';

type Props = {
  className?: string;
  iconClassName?: string;
  showName?: boolean;
  nameClassName?: string;
  subtitle?: string;
  size?: 'sm' | 'md' | 'lg';
};

const sizeMap = {
  sm: { box: 'h-8 w-8', text: 'text-sm', sub: 'text-2xs' },
  md: { box: 'h-10 w-10', text: 'text-lg', sub: 'text-2xs' },
  lg: { box: 'h-12 w-12', text: 'text-xl', sub: 'text-xs' },
};

/** Tenant logo + name for the app shell. Falls back to the initial when no logo. */
export function CompanyLogo({
  className,
  iconClassName,
  showName = true,
  nameClassName,
  subtitle = 'POS System',
  size = 'md',
}: Props) {
  const { companyName, logoUrl } = useBranding();
  const s = sizeMap[size];
  const initial = (companyName || 'A').charAt(0).toUpperCase();

  return (
    <div className={cn('flex items-center gap-3', className)}>
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logoUrl}
          alt={companyName}
          className={cn(s.box, 'rounded-md object-contain bg-background border border-border/50', iconClassName)}
        />
      ) : (
        <div className={cn(s.box, 'rounded-md bg-primary flex items-center justify-center shrink-0', iconClassName)}>
          <span className="font-display font-bold text-primary-foreground text-sm">{initial}</span>
        </div>
      )}
      {showName && (
        <div>
          <p className={cn('font-display font-semibold text-sidebar-foreground', s.text, nameClassName)}>
            {companyName}
          </p>
          {subtitle && (
            <p className={cn('text-muted-foreground tracking-luxury uppercase', s.sub)}>{subtitle}</p>
          )}
        </div>
      )}
    </div>
  );
}
