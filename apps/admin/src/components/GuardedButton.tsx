import { Button, type ButtonProps } from '@gocrypto/ui';
import { type PermissionRequirement, requirementLabel, useCan } from '../lib/permissions';

/** A button that is disabled (with an explanatory tooltip) when the admin lacks the permission. */
export function GuardedButton({ perm, disabled, title, ...rest }: ButtonProps & { perm: PermissionRequirement }) {
  const can = useCan();
  const allowed = can(perm);
  if (allowed) return <Button {...rest} title={title} disabled={disabled} />;
  return (
    <span title={`Requires permission: ${requirementLabel(perm)}`} style={{ display: 'inline-flex' }}>
      <Button {...rest} disabled aria-disabled="true" />
    </span>
  );
}
