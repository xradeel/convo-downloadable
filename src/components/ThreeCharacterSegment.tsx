import React, { useEffect, useRef } from 'react';
import { globalAudioPlayer } from '../utils/audioPlayer';
import { artworkFor, CastArtPoint, CastArtwork } from '../utils/castArtwork';
import { StageBackdrop } from './StageBackdrop';

interface ThreeCharacterSegmentProps {
  name: string;
  gender: 'male' | 'female';
  /** The cyclorama this performer is lit against. */
  color: string;
  isSpeaking: boolean;
  speechActivity: number; // 0.0 to 1.0 from audio player
  activeEmotion?: string;
  dialogueText?: string;
  /** What this performer is interjecting into the other one's line, if anything. */
  interjection?: string;
  /** Replaces Speaking/Listening, for a stage with nothing to read yet. */
  statusLabel?: string;
}

const TAU = Math.PI * 2;

/** Fraction of the card between the eye line and the chin. */
const FACE_HEIGHT = 0.255;
/** Where the eye line sits, as a fraction of the card height. */
const EYE_LINE = 0.4;

interface Placement {
  /** Where to blit the artwork, in canvas pixels. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Pupil to pupil, the yardstick for the eyes. */
  eyeSpan: number;
  /**
   * Nose base to chin, the yardstick for the mouth. Faces are stylised at
   * different proportions, so measuring the mouth against the eyes lets it
   * outgrow a short chin.
   */
  lowerFace: number;
}

/**
 * Sizes and positions the bust by its face rather than its bounding box, so
 * performers drawn at different crops hang like a portrait grid: eye lines and
 * chins land on the same two rules in every card, whatever the hair does above
 * them.
 */
function placeArtwork(art: CastArtwork, boxWidth: number, boxHeight: number): Placement {
  const { chin, noseBase, leftEye, rightEye } = art.anchors;
  const eyeY = (leftEye.y + rightEye.y) / 2;
  const scale = (boxHeight * FACE_HEIGHT) / ((chin.y - eyeY) * art.height);
  const width = art.width * scale;
  const height = art.height * scale;
  const faceCenterX = (leftEye.x + rightEye.x) / 2;

  return {
    x: boxWidth / 2 - faceCenterX * width,
    y: boxHeight * EYE_LINE - eyeY * height,
    width,
    height,
    eyeSpan: Math.abs(rightEye.x - leftEye.x) * width,
    lowerFace: Math.abs(chin.y - noseBase.y) * height,
  };
}

function anchorAt(point: CastArtPoint, placement: Placement) {
  return {
    x: placement.x + point.x * placement.width,
    y: placement.y + point.y * placement.height,
  };
}

/**
 * The mouth, drawn in the same flat-vector language as the artwork so it reads
 * as part of the illustration rather than an overlay.
 *
 * `open` is how far the jaw has dropped and `wide` is how spread the lips are:
 * bright vowels pull the corners out flat, dark ones round them up. The
 * opening grows mostly downwards, the way a real jaw moves.
 */
function drawMouth(
  ctx: CanvasRenderingContext2D,
  center: { x: number; y: number },
  /** Nose base to chin: every dimension below is a fraction of it. */
  unit: number,
  open: number,
  wide: number,
  palette: CastArtwork['palette']
) {
  const halfW = unit * (0.3 + 0.13 * wide);
  const halfH = unit * (0.03 + 0.18 * open) * (1.15 - 0.3 * wide);
  const ink = unit * 0.045;

  ctx.save();
  ctx.translate(center.x, center.y);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // Blank the lower face first: the artwork is generated mouthless, but any
  // stray lip line the model left behind has to go before we draw over it.
  ctx.fillStyle = palette.skin;
  ctx.beginPath();
  ctx.ellipse(0, unit * 0.02, unit * 0.45, unit * 0.17, 0, 0, TAU);
  ctx.fill();

  if (open < 0.06) {
    // Lips together: a relaxed line with a hint of volume underneath.
    ctx.strokeStyle = palette.ink;
    ctx.lineWidth = ink;
    ctx.beginPath();
    ctx.moveTo(-halfW * 0.78, -unit * 0.01);
    ctx.quadraticCurveTo(0, unit * 0.055, halfW * 0.78, -unit * 0.01);
    ctx.stroke();

    ctx.strokeStyle = palette.skinShadow;
    ctx.lineWidth = ink * 0.7;
    ctx.beginPath();
    ctx.moveTo(-halfW * 0.5, unit * 0.1);
    ctx.quadraticCurveTo(0, unit * 0.14, halfW * 0.5, unit * 0.1);
    ctx.stroke();
    ctx.restore();
    return;
  }

  // Cubic rather than quadratic curves: the corners of the opening need to be
  // soft, or an open mouth reads as a slot cut in the face.
  const mouth = new Path2D();
  mouth.moveTo(-halfW, 0);
  mouth.bezierCurveTo(-halfW * 0.55, -halfH * 0.9, halfW * 0.55, -halfH * 0.9, halfW, 0);
  mouth.bezierCurveTo(halfW * 0.62, halfH * 1.55, -halfW * 0.62, halfH * 1.55, -halfW, 0);
  mouth.closePath();

  ctx.fillStyle = palette.mouth;
  ctx.fill(mouth);

  ctx.save();
  ctx.clip(mouth);

  // Upper teeth hang from the top lip; the tongue only shows on a wide drop.
  if (open > 0.16) {
    ctx.fillStyle = palette.teeth;
    ctx.fillRect(-halfW, -halfH * 0.62, halfW * 2, Math.min(halfH * 0.62, unit * 0.085));
  }
  if (open > 0.45) {
    ctx.fillStyle = palette.tongue;
    ctx.beginPath();
    ctx.ellipse(0, halfH * 1.15, halfW * 0.62, halfH * 0.5, 0, 0, TAU);
    ctx.fill();
  }
  ctx.restore();

  ctx.strokeStyle = palette.ink;
  ctx.lineWidth = ink;
  ctx.stroke(mouth);

  // Lower lip, so an open mouth still has a jaw under it.
  const lipY = halfH * 1.55;
  ctx.strokeStyle = palette.skinShadow;
  ctx.lineWidth = ink * 0.8;
  ctx.beginPath();
  ctx.moveTo(-halfW * 0.6, lipY + unit * 0.05);
  ctx.quadraticCurveTo(0, lipY + unit * 0.12, halfW * 0.6, lipY + unit * 0.05);
  ctx.stroke();

  // On a real drop the shadow under the jaw deepens with it.
  if (open > 0.35) {
    ctx.globalAlpha = (open - 0.35) * 0.5;
    ctx.lineWidth = ink * 1.6;
    ctx.beginPath();
    ctx.moveTo(-halfW * 0.82, lipY + unit * 0.17);
    ctx.quadraticCurveTo(0, lipY + unit * 0.3, halfW * 0.82, lipY + unit * 0.17);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  ctx.restore();
}

/**
 * Drops an eyelid over a drawn eye: skin sweeps down inside the eye's own
 * outline, and the lash line lands on the lid's edge once it is far enough
 * along to be visible.
 */
function drawBlink(
  ctx: CanvasRenderingContext2D,
  eye: { x: number; y: number },
  /** Pupil to pupil: the eye's own size is a fraction of it. */
  unit: number,
  progress: number,
  palette: CastArtwork['palette']
) {
  const rx = unit * 0.25;
  const ry = unit * 0.17;
  const top = eye.y - ry * 1.6;
  const lidY = top + progress * ry * 3.1;

  const socket = new Path2D();
  socket.ellipse(eye.x, eye.y, rx * 1.15, ry * 1.6, 0, 0, TAU);

  // The lid's edge is curved, not a straight cut: a flat edge halfway down
  // reads as a heavy-lidded stare rather than a blink in progress.
  const lid = new Path2D();
  lid.moveTo(eye.x - rx * 1.3, top - ry);
  lid.lineTo(eye.x + rx * 1.3, top - ry);
  lid.lineTo(eye.x + rx * 1.3, lidY);
  lid.quadraticCurveTo(eye.x, lidY + ry * 0.5, eye.x - rx * 1.3, lidY);
  lid.closePath();

  ctx.save();
  ctx.clip(socket);
  ctx.fillStyle = palette.skin;
  ctx.fill(lid);

  if (progress > 0.2) {
    ctx.strokeStyle = palette.ink;
    ctx.lineWidth = unit * 0.038;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(eye.x - rx * 1.05, lidY);
    ctx.quadraticCurveTo(eye.x, lidY + ry * 0.5, eye.x + rx * 1.05, lidY);
    ctx.stroke();
  }
  ctx.restore();
}

export const ThreeCharacterSegment: React.FC<ThreeCharacterSegmentProps> = ({
  name,
  gender,
  color,
  isSpeaking,
  speechActivity,
  activeEmotion,
  dialogueText,
  interjection,
  statusLabel,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isSpeakingRef = useRef(isSpeaking);
  const activityRef = useRef(speechActivity);

  isSpeakingRef.current = isSpeaking;
  activityRef.current = speechActivity;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const art = artworkFor(name, gender);
    const portrait = new Image();
    let portraitReady = false;
    portrait.onload = () => {
      portraitReady = true;
    };
    portrait.src = art.image;

    // The card is fluid, so follow the element rather than the window.
    let boxWidth = 0;
    let boxHeight = 0;
    const measure = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      boxWidth = rect.width;
      boxHeight = rect.height;
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
    };
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(canvas);

    let animId: number;
    const startTime = performance.now();
    let lastTime = startTime;
    let blinkProgress = 0;
    let blinkTimer = 0;
    let blinkClosing = false;
    let nextBlinkInterval = 2.5 + Math.random() * 2.5;
    let mouthOpen = 0;
    let mouthWide = 0.5;
    let agree = 0;

    const render = (now: number) => {
      animId = requestAnimationFrame(render);

      const delta = Math.min((now - lastTime) * 0.001, 0.1);
      lastTime = now;
      const elapsed = (now - startTime) * 0.001;
      const speaking = isSpeakingRef.current;

      // Blink: a quick close, a slower open, then a randomised wait.
      blinkTimer += delta;
      if (blinkClosing) {
        blinkProgress += delta * 14;
        if (blinkProgress >= 1) {
          blinkProgress = 1;
          blinkClosing = false;
        }
      } else if (blinkProgress > 0) {
        blinkProgress -= delta * 9;
        if (blinkProgress <= 0) {
          blinkProgress = 0;
          blinkTimer = 0;
          nextBlinkInterval = 2.2 + Math.random() * 3.5;
        }
      } else if (blinkTimer > nextBlinkInterval) {
        blinkClosing = true;
      }

      // Lip sync. The waveform is polled straight from the player so the mouth
      // tracks the audio instead of React's last committed render.
      const voice = globalAudioPlayer.getSpeechShape();
      const interjection = globalAudioPlayer.getBackchannel();
      const isInterjecting =
        !speaking && interjection?.speaker.toUpperCase() === name.toUpperCase();

      let targetOpen = 0;
      let targetWide = 0.5;

      if (speaking) {
        const level = Math.max(activityRef.current, voice.level);
        let open = level > 0.04 ? Math.min(1, Math.max(0.14, level * 1.2)) : 0;

        // When the listening partner speaks a backchannel, suppress the main speaker's
        // mouth so they don't mouth the partner's words while listening!
        if (interjection && interjection.speaker.toUpperCase() !== name.toUpperCase()) {
          const suppression = Math.max(0, 1 - interjection.level * 1.35);
          open *= suppression;
        }

        targetOpen = open;
        targetWide = voice.brightness;
      } else if (isInterjecting && interjection) {
        // The listener is saying the interjection. Its level comes from the
        // interjection's own clip, never from the line it lands in, or the
        // listener would mouth the speaker's words. No floor on the opening:
        // the waveform should close the mouth between sounds.
        const level = interjection.level;

        if (interjection.phoneticType === 'hum') {
          // A closed hum ("mhm", "mm"): the lips barely part at all.
          targetOpen = Math.min(0.15, level * 0.28);
          targetWide = 0.3;
        } else if (interjection.phoneticType === 'spread') {
          // A front vowel ("yeah", "right", "it did"): corners pull wide.
          targetOpen = Math.min(0.8, level * 1.1);
          targetWide = 0.72;
        } else {
          // Anything else ("uh-huh", "okay", "sure"): a plain small drop.
          targetOpen = Math.min(0.85, level * 1.2);
          targetWide = 0.46;
        }
      }

      // Smoothed so the agreeing nod swells and settles instead of snapping.
      const targetAgree = isInterjecting && interjection ? interjection.level : 0;
      agree += (targetAgree - agree) * (1 - Math.exp(-delta * 14));

      // Asymmetric smoothing: consonants snap the mouth shut faster than
      // vowels open it, which is what keeps speech from looking like chewing.
      const attack = targetOpen > mouthOpen ? 22 : 15;
      mouthOpen += (targetOpen - mouthOpen) * (1 - Math.exp(-delta * attack));
      mouthWide += (targetWide - mouthWide) * (1 - Math.exp(-delta * 9));

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, boxWidth, boxHeight);

      if (portraitReady && boxWidth > 0 && boxHeight > 0) {
        const placement = placeArtwork(art, boxWidth, boxHeight);

        // Breath, idle sway, and a nod on the beat of the delivery. Pivoting
        // low keeps the shoulders planted while the head does the moving.
        const breath = Math.sin(elapsed * 1.8) * (boxHeight * 0.005);
        const nodProgress = interjection ? Math.min(1, interjection.age / interjection.duration) : 0;
        const nod = speaking
          ? Math.sin(elapsed * 5.2) * (boxHeight * 0.004) * (0.4 + mouthOpen)
          : // Listening: the interjection comes with an affirmative head dip.
            agree * (boxHeight * 0.018) * Math.sin(nodProgress * Math.PI);
        const sway = Math.sin(elapsed * 0.7) * (boxWidth * 0.004);
        const tilt = Math.sin(elapsed * (speaking ? 2.6 : 1.1)) * (speaking ? 0.009 : 0.005);

        ctx.translate(boxWidth / 2 + sway, boxHeight + breath + nod);
        ctx.rotate(tilt);
        ctx.translate(-boxWidth / 2, -boxHeight);

        ctx.drawImage(portrait, placement.x, placement.y, placement.width, placement.height);
        drawMouth(
          ctx,
          anchorAt(art.anchors.mouth, placement),
          placement.lowerFace,
          mouthOpen,
          mouthWide,
          art.palette
        );

        if (blinkProgress > 0.02) {
          drawBlink(ctx, anchorAt(art.anchors.leftEye, placement), placement.eyeSpan, blinkProgress, art.palette);
          drawBlink(ctx, anchorAt(art.anchors.rightEye, placement), placement.eyeSpan, blinkProgress, art.palette);
        }
      }

      ctx.restore();
    };

    animId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animId);
      observer.disconnect();
      portrait.onload = null;
    };
  }, [gender, name]);

  return (
    <StageBackdrop
      color={color}
      name={name}
      isSpeaking={isSpeaking}
      activeEmotion={activeEmotion}
      dialogueText={dialogueText}
      interjection={interjection}
      statusLabel={statusLabel}
    >
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
    </StageBackdrop>
  );
};
