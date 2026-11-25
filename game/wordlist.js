// game/wordlist.js — a compact, family-friendly dictionary for Word Bomb.
// Each word is 3–9 letters. We build a bigram index at load time so the engine
// can guarantee a fair bigram (one with several valid answers) every round.

const RAW = `about above abuse actor acute admit adopt adult after again agent agree
ahead alarm album alert alike alive allow alone along alter among anger angle angry
ankle apart apple apply arena argue arise array arrow aside asset audio audit avoid
awake award aware badge baker basic basin batch beach beard beast began begin being
below bench berry birth black blade blame blank blast blend bless blind block blood
board boost booth bound brain brand brass brave bread break breed brick bride brief
bring broad broke brown brush build built bunch burst buyer cabin cable camel candy
canoe cargo carry carve catch cause chain chair chalk charm chart chase cheap check
cheek cheer chess chest chief child chose civic claim class clean clear clerk click
cliff climb clock close cloth cloud coach coast cobra cocoa colon color comet comic
coral couch could count court cover crack craft crane crash crate crawl crazy cream
creek crest crime crisp cross crowd crown crude curve cycle daily dairy dance dealt
death debut delay delta dense depth derby devil diary dirty disco ditch diver dizzy
dodge doing donor doubt dozen draft drain drama drank dream dress dried drift drill
drink drive drove drown eager eagle early earth eight elbow elder elect elite empty
enemy enjoy enter entry equal error essay event every exact exist extra fable faced
fairy faith false fancy fatal fault favor feast fence ferry fever fiber field fifth
fifty fight final first flame flash fleet flesh float flock flood floor flour fluid
focus force forge forth forty forum found frame fraud fresh fried front frost fruit
fully funny giant given glass globe glory glove grace grade grain grand grant grape
graph grass grave great green greet grief grill grind groan groom gross group grove
grown guard guess guest guide happy harsh haste hatch haunt heart heavy hedge hello
hence hobby honey honor horse hotel house hover human humor hurry ideal image imply
index inner input irony issue ivory jelly jewel joint judge juice jumbo knife knock
known label labor laser later laugh layer learn lease least leave legal lemon level
lever light limit linen liver lobby local lodge logic loose lorry loser lower loyal
lucky lunar lunch lying magic major maker maple march marsh match maybe mayor medal
media melon mercy merge merit metal meter midst might minor minus mixed model moist
money month moral motor mount mouse mouth movie music naked nasty naval needy nerve
never newly night noble noise north noted novel nurse oasis occur ocean offer often
olive onion opera orbit order organ other ought ounce outer owner oxide ozone paint
panel panic paper party pasta patch pause peace peach pearl pedal penny phase phone
photo piano piece pilot pitch pixel pizza place plain plane plant plate plaza plead
point polar porch pound power press price pride prime print prior prize probe prone
proof proud prove pulse punch pupil puppy purse queen query quest queue quick quiet
quilt quota quote radar radio raise rally ranch range rapid ratio reach react ready
realm rebel refer reign relax relay renew repay reply rider ridge rifle right rigid
rinse risky rival river roast robot rocky rogue roman rough round route royal rugby
ruler rural sadly saint salad salon sauce scale scare scene scent scope score scout
scrap screw scrub seize sense serve seven shade shaft shake shall shape share shark
sharp sheep sheet shelf shell shift shine shirt shock shoot shore short shout shown
sight silly since siren sixty skill skirt slave sleep slice slide slope small smart
smile smoke snack snake sneak solar solid solve sorry sound south space spare spark
speak spear speed spell spend spice spike spill spine split spoke spoon sport spray
squad stack staff stage stain stair stake stall stamp stand stare start state steak
steal steam steel steep steer stern stick still stock stone stood store storm story
stove strap straw strip stuck study stuff style sugar suite sunny super surge sweet
swift swing sword table taken taste teach tempo tenth thank theft their theme there
these thick thief thing think third thirty those three threw throw thumb tiger tight
timer tired title toast today token tooth topic torch total touch tough tower toxic
trace track trade trail train trait trash treat trend trial tribe trick tried troop
trout truck trunk trust truth tulip tutor twice twist ultra uncle under union unite
unity until upper upset urban usage usual utter vague valid value valve vapor vault
venue verse video vigor villa vinyl viral virus visit vital vivid vocal voice voter
wagon waist waste watch water weary weave wedge weigh weird whale wheat wheel where
while white whole whose widow width witch woman world worry worse worst worth would
wound wrist write wrong wrote yacht yield young youth zebra`;

const WORDS = Array.from(new Set(RAW.split(/\s+/).map((w) => w.toLowerCase()).filter((w) => w.length >= 3)));
const WORD_SET = new Set(WORDS);
const BIGRAM_INDEX = new Map();

for (const w of WORDS) {
  for (let i = 0; i < w.length - 1; i++) {
    const bg = w.slice(i, i + 2);
    if (!BIGRAM_INDEX.has(bg)) BIGRAM_INDEX.set(bg, []);
    BIGRAM_INDEX.get(bg).push(w);
  }
}

// Only bigrams with plenty of answers make a fair round.
const FAIR_BIGRAMS = [...BIGRAM_INDEX.entries()]
  .filter(([, list]) => list.length >= 5)
  .map(([bg]) => bg);

function wordsWith(bigram) {
  return BIGRAM_INDEX.get(String(bigram).toLowerCase()) || [];
}

module.exports = { WORDS, WORD_SET, FAIR_BIGRAMS, wordsWith };
