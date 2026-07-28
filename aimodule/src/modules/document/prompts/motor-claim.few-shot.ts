export const REGIONAL_LANGUAGE_FEW_SHOTS = `
=== HANDWRITTEN ANSWER LANGUAGE (critical) ===
Printed form labels are English and/or Hindi. Handwritten ANSWERS may be in ANY Indian language/script.
NEVER translate, transliterate, or summarize narrative/address fields.

| Scenario | Printed label | Handwritten (preserve exactly) | JSON key |
| Hindi narrative | दुर्घटना का संक्षिप्त विवरण | और अचानक ब्रेक मारने से गाड़ी पलट गई | accidentDescription |
| Bengali address | Address / पता | বিহার, গয়া, পুরুলিয়া | insuredAddress |
| Odia narrative | Brief description | ଗାଡ଼ି ପାଖରେ ପଥର ସହ ଟକରା ହେଲା | accidentDescription |
| Tamil address | Address | தமிழ்நாடு, சென்னை | driverAddress |
| Telugu narrative | accident description | అకస్మాత్తుగా బ్రేక్ మార్చడంతో | accidentDescription |
| Kannada area | Address | ಬೆಂಗಳೂರು, ಕರ್ನಾಟಕ | insuredAddress |
| English on Hindi form | Place | Steel Gate, Saridhela | accidentLocation |
| Mixed script | Insured Name + Address | MR. GOPAL CHANDRA + Bengali address lines | insuredName + insuredAddress |

STRUCTURED IDs (policy, reg, DL, engine, chassis): extract as printed; labels may be Hindi.
NARRATIVE fields (accidentDescription, addresses): preserve original script — Devanagari, Bengali, Odia, Tamil, Telugu, Kannada, etc.
If unreadable → null. Never invent an English summary.
`;

export const EXTRA_FIELDS_RULE = `
=== EXTRA FIELDS (unmapped labels) ===
1. Map all recognizable fields to superset schema keys FIRST.
2. Any printed label with a handwritten value that does NOT map to a schema key → extraFields[].
   Format: { "key": "<printed label as on form>", "value": "<handwritten value verbatim>" }
3. UIIC one-page examples: Pin Code, State, Aadhar No, GST NO, Workshop Mobile,
   "Any Injury/Death to Driver", "Theft of Vehicle Yes/No", "Any TP Injury/Death".
4. Do NOT duplicate schema-mapped values in extraFields.
5. Preserve regional script in extraFields values same as narrative fields.
`;
