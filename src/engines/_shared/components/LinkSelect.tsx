import { useTranslation } from '@/i18n/useTranslation';

export interface LinkSelectOption {
  id: string;
  label: string;
}

export interface LinkSelectProps {
  /** Rótulo del campo, ya traducido por quien llama. */
  label: string;
  /** Id enlazado, o cadena vacía si no hay enlace. */
  value: string;
  /** Devuelve el id elegido, o cadena vacía al desenlazar. */
  onChange: (value: string) => void;
  /** A qué se puede apuntar. Si viene vacío, el campo no se dibuja. */
  options: LinkSelectOption[];
  /**
   * Texto de la opción «sin enlazar». Por defecto, `common.noLink`.
   *
   * Se puede sustituir porque hay motores con una frase mejor para su caso
   * («Sin escena enlazada» dice más que «Sin enlazar» en un guion), y esas
   * claves ya existen.
   */
  emptyLabel?: string;
}

/**
 * El desplegable de UN enlace entre motores.
 *
 * Vivía dentro de `seeds/components/SeedsEngine.tsx` como función local sin
 * exportar, y era el único sitio de la aplicación donde se podía enlazar una
 * entidad con otra de otro motor. La auditoría del 2026-08-16 encontró cinco
 * campos `linked*Id` más declarados en `types.ts` y sin ninguna forma de
 * rellenarlos —los dos de `ArcBeat`, los tres de `Payoff`—, y dos de ellos los
 * LEE `services/projectIntelligence.ts` para pintar medidores del Cockpit, que
 * por eso marcaban cero para siempre.
 *
 * Sube aquí antes de cablear esos cinco: cuatro copias del mismo desplegable
 * divergen a la primera corrección, y este proyecto ya se comió esa lección con
 * la barra de escala del mapa, escrita dos veces en dos vistas de la misma
 * cámara.
 *
 * **Se esconde solo cuando no hay a qué apuntar.** Un `<select>` con una única
 * opción que dice «sin enlazar» no es una función, es ruido en un proyecto
 * recién creado — y peor: promete algo que todavía no se puede hacer.
 */
export default function LinkSelect({
  label,
  value,
  onChange,
  options,
  emptyLabel,
}: LinkSelectProps) {
  const { t } = useTranslation();
  if (options.length === 0) return null;
  return (
    <label className="space-y-1 block">
      <span className="text-xs text-text-dim">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-1.5 text-sm bg-elevated border border-border rounded-lg text-text-primary outline-none focus:border-accent-gold transition cursor-pointer"
      >
        <option value="">{emptyLabel ?? t('common.noLink')}</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}
