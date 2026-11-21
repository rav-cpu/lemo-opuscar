# QA report — gpu-ai

**PASS**: 0 error(s), 1 warning(s). Sampled every 0.125s over 47.013s; overlaps must last ≥ 0.25s to count.

| Check | Result |
|---|---|
| voice | ⚠️ 1 |
| empty-scene | ✅ |
| text-overlap | ✅ |
| label-crossed | ✅ |
| knob-overlap | ✅ |
| hud-collision | ✅ |
| subtitle-zone | ✅ |
| safe-area | ✅ |
| aspect | ✅ |
| camera-jerk | ✅ |
| luma-pop | ✅ |
| black-frames | ✅ |
| voice-overlap | ✅ |
| silence-broken | ✅ |
| voice-late | ✅ |
| subtitle-short | ✅ |
| subtitle-early | ✅ |
| subtitle-overlap | ✅ |
| loudness | ✅ |
| true-peak | ✅ |
| length | ✅ |
| reading-time | ✅ |

Audio: -14.6 LUFS integrated, true peak -2.1 dBTP, length 47s.

Voice: **kokoro** (af_heart). Lexicon terms: AI, CPU, GPU, GPUs.

Exactly what each line was told to say (phonemes):

- s1: `wˌaɪ dˈʌz ˌeɪˈaɪ ɹˈʌn ˌɔn dʒˌiːpˌiːjˈuːz... ænd nˌɑːt ˌɔn ɐ nˈɔːɹməl sˌiːpˌiːjˈuː?`
- s2: `bɪkˈʌz ˌʌndɚ ðə hˈʊd, ˌeɪˈaɪ ɪz mˈoʊstli wˈʌn θˈɪŋ. mˌʌltɪplˈaɪɪŋ ɡɹˈɪdz ʌv nˈʌmbɚz.`
- s3: `ænd ɐ bˈɪɡ mˈɑːdəl dˈʌz ðæt bˈɪliənz ʌv tˈaɪmz, fɔːɹ ˈɛvɹi sˈɪŋɡəl wˈɜːd ɪt ɹˈaɪts.`
- s4: `ɐ sˌiːpˌiːjˈuː hɐz ɐ fjˈuː vˈɛɹi fˈæst kˈɔːɹz. ðeɪ wˈɜːk θɹuː ðə lˈɪst, wˈʌn stˈɛp ˈæftɚɹ ɐnˈʌðɚ.`
- s5: `ɐ dʒˌiːpˌiːjˈuː hɐz θˈaʊzəndz ʌv sˈɪmplɚ kˈɔːɹz. ðeɪ ˈɔːl mˌʌltɪplˈaɪ æt ðə sˈeɪm tˈaɪm.`
- s6: `sˌoʊ wɛn ðə ɡɹˈɪd ɡˈɛts bˈɪɡɚ, ðə sˌiːpˌiːjˈuː slˈoʊz ɹˈaɪt dˈaʊn. ðə dʒˌiːpˌiːjˈuː bˈɛɹli nˈoʊɾɪsᵻz.`
- s7: `sˈeɪm mˈæθ. dʒˈʌst dˈʌn ɪn pˈæɹəlˌɛl. ðæts ðə hˈoʊl sˈiːkɹᵻt.`

## Findings

- **WARN** `voice` : voice is the local fallback (kokoro af_heart); set ELEVENLABS_API_KEY for the human voice

## Not covered automatically

- Whether the voice *sounds* natural, and whether the facts in the script are right: a human listens once.
- Taste: pacing, whether a shot is interesting. The contact sheet (qa/contact.jpg) is for that.
