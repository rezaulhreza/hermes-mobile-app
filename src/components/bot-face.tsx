import Svg, { Circle, Ellipse, Path, Rect } from 'react-native-svg'

import { isDarkColour, type Look, paint } from '@/core/avatars'

/**
 * The drawn avatar of a bot: its shape in its colour, with two eyes. The
 * shapes and the place of the eyes are the desktop app's (`shapeNode` and
 * `BotFace` of its `hermes-bots` plugin), in the same box of 40 by 40, so a
 * bot has one face on both. The desktop's face moves; this one is still.
 */
export function BotFace({ look, size }: { look: Look; size: number }) {
  const colour = paint(look.color)
  const dark = isDarkColour(look.color)
  const eye = dark ? 'rgba(232,220,195,0.95)' : 'rgba(0,0,0,0.85)'
  const light = dark ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.85)'
  // The cloud sits lower in its box, and the tip of a triangle and of a drop is too thin for eyes.
  const eyeY = look.shape === 'cloud' ? 22 : look.shape === 'triangle' || look.shape === 'drop' ? 23.5 : 17.2
  // A corner drawn with a wide round line is a soft corner.
  const soft = { fill: colour, stroke: colour, strokeWidth: 7, strokeLinejoin: 'round' as const }

  return (
    <Svg height={size} viewBox="0 0 40 40" width={size}>
      {look.shape === 'squircle' ? (
        <Rect fill={colour} height={34} rx={11} width={34} x={3} y={3} />
      ) : look.shape === 'pill' ? (
        <Rect fill={colour} height={26} rx={13} width={36} x={2} y={7} />
      ) : look.shape === 'triangle' ? (
        <Path d="M20 5.5 L36 33.5 L4 33.5 Z" {...soft} />
      ) : look.shape === 'hexagon' ? (
        <Path d="M20 3.5 L34.5 11.75 L34.5 28.25 L20 36.5 L5.5 28.25 L5.5 11.75 Z" {...soft} />
      ) : look.shape === 'cloud' ? (
        <Path d="M11 32 a7.5 7.5 0 0 1 -1 -14.9 A9.5 9.5 0 0 1 29 12.5 A7 7 0 0 1 30 32 Z" fill={colour} />
      ) : look.shape === 'drop' ? (
        <Path d="M20 3 C20 3 6 20 6 27 a14 13.5 0 0 0 28 0 C34 20 20 3 20 3 Z" fill={colour} />
      ) : (
        <Circle cx={20} cy={20} fill={colour} r={17.5} />
      )}
      <Ellipse cx={15.4} cy={eyeY} fill={eye} rx={2.2} ry={2.3} />
      <Ellipse cx={24.6} cy={eyeY} fill={eye} rx={2.2} ry={2.3} />
      <Circle cx={14.8} cy={eyeY - 0.7} fill={light} r={0.65} />
      <Circle cx={24} cy={eyeY - 0.7} fill={light} r={0.65} />
    </Svg>
  )
}
