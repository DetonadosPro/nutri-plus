export const MIN_FEEDBACK_CONTEXT_USES=3;
export const MAX_FEEDBACK_TIE_BREAK=.08;

/**
 * Sinal conservador e suavizado: uma observação isolada não influencia o ranking.
 * O valor só é consumido dentro de uma faixa de equivalência semântica de 0,01.
 */
export function feedbackBoostFromUses(uses:number){
  const safe=Math.max(0,Number.isFinite(uses)?Math.trunc(uses):0);
  if(safe<MIN_FEEDBACK_CONTEXT_USES)return 0;
  return Math.min(MAX_FEEDBACK_TIE_BREAK,MAX_FEEDBACK_TIE_BREAK*(safe-MIN_FEEDBACK_CONTEXT_USES+1)/(safe+3));
}
