'use client';

import { cn } from '@/lib/utils';
import { useBranding } from '@/contexts/BrandingContext';
import { AirinLogo } from '@/components/shared/AirinLogo';

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

/** Tenant logo + name for the app shell. Falls back to the Airin mark when the
 * tenant has uploaded no logo of its own. */
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
        // No tenant logo uploaded: the Airin mark is the default, and this
        // preview must show what the app actually renders.
        <AirinLogo size={size} showWordmark={false} className={iconClassName} />
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
