type CatalogFood = {
  source_code?: string;
  description?: string;
  displayName?: string | null;
  category?: string | null;
};

function normalize(value:string){
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
}

const NATURALLY_RAW=/^(?:alface|pepino|tomate|rucula|agriao|repolho|cenoura|beterraba|cebola|pimentao|abobrinha|fruta|banana|maca|manga|pera|uva|morango|melancia|melao|abacaxi|mam[aã]o)\b/i;
const COOK_BEFORE_EATING=/\b(?:arroz|feij[aã]o|carne|bovin[oa]|su[ií]n[oa]|frango|galinha|bisteca|lombo|pernil|costela|peito|macarr[aã]o|massa)\b/i;

/** Nome destinado ao paciente; a descrição e o source_code originais permanecem intactos. */
export function patientFoodName(food:CatalogFood){
  let name=(food.displayName?.trim()||food.description||'').replace(/\s*\([^)]*\)/g,' ');
  name=name
    .replace(/\s+(?:com|sem)\s+sal\b/giu,' ')
    .replace(/\s+sem\s+(?:óleo|oleo|gordura)\b/giu,' ')
    .replace(/\s+com\s+(?:óleo|oleo|azeite|manteiga|gordura)(?:\s+de\s+[\p{L}-]+)?(?:\s+cebola(?:\s+e)?\s+alho)?\b/giu,' ')
    .replace(/\b(?:UHT|pasteurizad[oa])\b/giu,' ')
    .replace(/^Macarrão\s+trigo\s+com\s+ovos\b/iu,'Macarrão')
    .replace(/^Macarrão\s+trigo\s+integral\b/iu,'Macarrão integral')
    .replace(/^Pepino\s+com\s+casca\s+cru\b/iu,'Pepino')
    .replace(/^Bisteca\s+suíno\b/iu,'Bisteca suína')
    .replace(/^Linguiça\s+suíno\b/iu,'Linguiça suína')
    .replace(/^Costela\s+suíno\b/iu,'Costela suína')
    .replace(/^Peito\s+bovino\s+(grelhada|cozida|frita|assada|refogada)\b/iu,(_match,prep:string)=>`Peito bovino ${{grelhada:'grelhado',cozida:'cozido',frita:'frito',assada:'assado',refogada:'refogado'}[prep]}`)
    .replace(/^(Lombo|Pernil)\s+suíno\s+assada\b/iu,'$1 suíno assado')
    .replace(/^(Lombo|Pernil)\s+suíno\s+(crua|frita|refogada)\b/iu,(_match,cut:string,prep:string)=>`${cut} suíno ${{crua:'cru',frita:'frito',refogada:'refogado'}[prep]}`);
  if(NATURALLY_RAW.test(name))name=name.replace(/\s+cru[as]?\b/giu,' ');
  return name.replace(/\s{2,}/g,' ').replace(/\s+([,;])/g,'$1').trim();
}

export function shouldHideRawFood(food:CatalogFood,query:string){
  if(/\bcru[as]?\b/i.test(query))return false;
  const name=food.displayName?.trim()||food.description||'';
  return /\bcru[as]?\b/i.test(name)&&COOK_BEFORE_EATING.test(name)&&!NATURALLY_RAW.test(name);
}

/** Colapsa somente variantes cuja face humana é idêntica; o representante mantém ID e nutrientes próprios. */
export function presentFoodSearchResults<T extends CatalogFood>(foods:T[],query:string,limit=25){
  const seen=new Set<string>(),result:Array<T&{displayName:string}>=[];
  for(const food of foods){
    if(shouldHideRawFood(food,query))continue;
    const displayName=patientFoodName(food),key=normalize(displayName);
    if(!key||seen.has(key))continue;
    seen.add(key);result.push({...food,displayName});
    if(result.length>=limit)break;
  }
  return result;
}
