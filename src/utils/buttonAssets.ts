export type TextButtonSize = 'xxs' | 'xs' | 's' | 'm' | 'l' | 'xl' | 'xxl';
export type IconButtonSize = 'diamond' | 'xxs';
export type ButtonVariant = 'primary' | 'secondary';
export type IconName = 'plus' | 'close' | 'check' | 'delete' | 'locked' | 'unlocked' | 'cog' | 'return' | 'question-mark' | 'next';

const backgroundImages = import.meta.glob<{ default: string }>('../assets/images/buttons/backgrounds/*.png', { eager: true });

const iconImages = import.meta.glob<{ default: string }>('../assets/images/buttons/icons/*.png', { eager: true });

export function getButtonBackgroundUrl(variant: ButtonVariant, size: TextButtonSize | IconButtonSize): string {
  // The secondary diamond asset has a typo in the filename ("dimond" instead of "diamond")
  const fileSuffix = variant === 'secondary' && size === 'diamond' ? 'dimond' : size;
  const key = `../assets/images/buttons/backgrounds/button-${variant}-${fileSuffix}.png`;
  return backgroundImages[key]?.default ?? '';
}

export function getButtonIconUrl(icon: IconName): string {
  const key = `../assets/images/buttons/icons/${icon}.png`;
  return iconImages[key]?.default ?? '';
}
