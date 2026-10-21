import type { Destination } from "./types";

/**
 * DEMO CATALOG. All prices are rough estimates in INR for demonstration only;
 * they are not live fares, rates or availability, and hotel names are generic
 * placeholders rather than real properties.
 */

/** Destination photos are bundled locally (public/images/destinations; Unsplash licence) so they never break. */
const img = (destinationId: string) => `/images/destinations/${destinationId}.jpg`;

export const DESTINATIONS: Destination[] = [
  {
    id: "bali",
    name: "Bali",
    country: "Indonesia",
    aliases: ["bali", "ubud", "seminyak", "indonesia", "nusa penida", "kuta"],
    image: img("bali"),
    tagline: "Temples, rice terraces and sunset beaches",
    description:
      "Bali blends lush inland culture around Ubud with laid-back beach towns in the south. Great for families, couples and first-time international travellers.",
    bestMonths: [4, 5, 6, 7, 8, 9],
    interests: ["beaches", "culture", "nature", "wellness", "romance", "adventure", "food"],
    idealDays: [5, 8],
    flightEconomyPerPerson: 32000,
    arrivalAirport: "Denpasar (DPS)",
    localTransportPerDay: 3200,
    mealsPerPersonPerDay: 1800,
    visaNote: "Demo note: Indian passport holders typically use visa on arrival. Verify current rules before travel.",
    hotels: [
      { tier: "budget", name: "Seminyak garden 3★ stay (sample)", area: "Seminyak", nightlyRate: 3500, highlights: "Pool, walkable to beach clubs" },
      { tier: "midrange", name: "Ubud jungle-view 4★ resort (sample)", area: "Ubud", nightlyRate: 7500, highlights: "Infinity pool, rice-field views" },
      { tier: "luxury", name: "Uluwatu cliffside private-pool villa (sample)", area: "Uluwatu", nightlyRate: 22000, highlights: "Private pool, ocean views" },
    ],
    activities: [
      { id: "bali-uluwatu", title: "Uluwatu Temple & Kecak fire dance", area: "Uluwatu", tags: ["culture", "history", "romance"], hours: 4, costPerPerson: 1400, kidFriendly: true, intensity: "easy", description: "Cliff-top sea temple at sunset followed by the traditional Kecak performance." },
      { id: "bali-rice", title: "Tegallalang rice terraces & swing", area: "Ubud", tags: ["nature", "adventure"], hours: 3, costPerPerson: 1800, kidFriendly: true, intensity: "moderate", description: "Walk the iconic terraces with an optional jungle swing." },
      { id: "bali-monkey", title: "Sacred Monkey Forest Sanctuary", area: "Ubud", tags: ["nature", "family_fun", "wildlife"], hours: 2, costPerPerson: 600, kidFriendly: true, intensity: "easy", description: "Shaded forest walk among temples and long-tailed macaques." },
      { id: "bali-nusa", title: "Nusa Penida day trip", area: "Nusa Penida", tags: ["beaches", "adventure", "nature"], hours: 9, costPerPerson: 5200, childCost: 4200, kidFriendly: false, intensity: "active", description: "Fast boat to Kelingking Beach, Broken Beach and Angel's Billabong." },
      { id: "bali-batur", title: "Mount Batur sunrise trek", area: "Kintamani", tags: ["adventure", "nature"], hours: 7, costPerPerson: 3800, kidFriendly: false, intensity: "active", description: "Early-morning volcano hike with breakfast at the summit." },
      { id: "bali-waterbom", title: "Waterbom Bali water park", area: "Kuta", tags: ["family_fun", "adventure"], hours: 5, costPerPerson: 3600, childCost: 2600, kidFriendly: true, intensity: "moderate", description: "One of Asia's top-rated water parks with slides for all ages." },
      { id: "bali-spa", title: "Balinese spa & flower bath", area: "Ubud", tags: ["wellness", "romance"], hours: 2.5, costPerPerson: 2800, kidFriendly: false, intensity: "easy", description: "Traditional massage followed by a floral bath." },
      { id: "bali-tanahlot", title: "Tanah Lot sunset temple", area: "Tabanan", tags: ["culture", "romance", "history"], hours: 3, costPerPerson: 900, kidFriendly: true, intensity: "easy", description: "Sea temple on a rock outcrop, famous for sunsets." },
      { id: "bali-cooking", title: "Balinese cooking class & market visit", area: "Ubud", tags: ["food", "culture"], hours: 4, costPerPerson: 2600, kidFriendly: true, intensity: "easy", description: "Morning market visit and hands-on cooking of local dishes; vegetarian menus available." },
      { id: "bali-beachclub", title: "Seminyak beach club afternoon", area: "Seminyak", tags: ["beaches", "nightlife"], hours: 4, costPerPerson: 2500, kidFriendly: false, intensity: "easy", description: "Pool loungers and sunset DJ sets on the west coast." },
      { id: "bali-rafting", title: "Ayung River white-water rafting", area: "Ubud", tags: ["adventure", "nature"], hours: 4, costPerPerson: 3000, childCost: 2400, kidFriendly: true, intensity: "active", description: "Grade II–III rapids suitable for beginners (minimum age applies)." },
      { id: "bali-snorkel", title: "Blue Lagoon snorkelling", area: "Padang Bai", tags: ["beaches", "wildlife", "family_fun"], hours: 4, costPerPerson: 2200, kidFriendly: true, intensity: "moderate", description: "Calm-water snorkelling with reef fish, gear included." },
    ],
  },
  {
    id: "thailand",
    name: "Thailand (Phuket & Krabi)",
    country: "Thailand",
    aliases: ["thailand", "phuket", "krabi", "phi phi", "bangkok", "pattaya"],
    image: img("thailand"),
    tagline: "Island hopping, street food and limestone cliffs",
    description:
      "Thailand's Andaman coast offers turquoise bays, island tours and lively night markets, with easy logistics for families and groups.",
    bestMonths: [11, 12, 1, 2, 3, 4],
    interests: ["beaches", "nightlife", "food", "adventure", "family_fun", "shopping", "culture"],
    idealDays: [5, 8],
    flightEconomyPerPerson: 26000,
    arrivalAirport: "Phuket (HKT)",
    localTransportPerDay: 2800,
    mealsPerPersonPerDay: 1500,
    visaNote: "Demo note: entry rules for Indian travellers have changed several times. Verify current requirements before travel.",
    hotels: [
      { tier: "budget", name: "Patong 3★ city hotel (sample)", area: "Patong", nightlyRate: 3000, highlights: "Rooftop pool, near Bangla Road" },
      { tier: "midrange", name: "Ao Nang 4★ beach resort (sample)", area: "Krabi", nightlyRate: 6500, highlights: "Steps from the beach, kids' club" },
      { tier: "luxury", name: "Kata hillside 5★ pool villa (sample)", area: "Kata", nightlyRate: 19000, highlights: "Private pool, Andaman views" },
    ],
    activities: [
      { id: "th-phiphi", title: "Phi Phi Islands speedboat tour", area: "Phuket", tags: ["beaches", "adventure", "nature"], hours: 8, costPerPerson: 4200, childCost: 3200, kidFriendly: true, intensity: "moderate", description: "Maya Bay, Pileh Lagoon and snorkelling stops by speedboat." },
      { id: "th-jamesbond", title: "Phang Nga Bay & James Bond Island", area: "Phang Nga", tags: ["nature", "adventure"], hours: 8, costPerPerson: 3800, childCost: 2900, kidFriendly: true, intensity: "easy", description: "Sea-canoe through caves among towering karsts." },
      { id: "th-bigbuddha", title: "Big Buddha & Old Phuket Town", area: "Phuket", tags: ["culture", "history", "shopping"], hours: 4, costPerPerson: 1500, kidFriendly: true, intensity: "easy", description: "Hilltop Buddha views and Sino-Portuguese shophouses." },
      { id: "th-fantasea", title: "Phuket FantaSea show", area: "Kamala", tags: ["family_fun", "culture"], hours: 4, costPerPerson: 3500, childCost: 3000, kidFriendly: true, intensity: "easy", description: "Evening cultural theme park and stage show with buffet." },
      { id: "th-fourisland", title: "Krabi 4-island longtail tour", area: "Krabi", tags: ["beaches", "nature"], hours: 6, costPerPerson: 2400, childCost: 1800, kidFriendly: true, intensity: "easy", description: "Phra Nang Cave Beach, Chicken Island and Tup Island sandbar." },
      { id: "th-elephant", title: "Ethical elephant sanctuary visit", area: "Phuket", tags: ["wildlife", "nature", "family_fun"], hours: 4, costPerPerson: 3800, childCost: 2600, kidFriendly: true, intensity: "easy", description: "Observation-only sanctuary with no riding." },
      { id: "th-cooking", title: "Thai cooking class", area: "Phuket", tags: ["food", "culture"], hours: 4, costPerPerson: 2500, kidFriendly: true, intensity: "easy", description: "Market tour and four-course cooking session; vegetarian options." },
      { id: "th-bangla", title: "Bangla Road nightlife walk", area: "Patong", tags: ["nightlife"], hours: 3, costPerPerson: 1200, kidFriendly: false, intensity: "easy", description: "Phuket's busiest nightlife strip (adults only)." },
      { id: "th-spa", title: "Traditional Thai massage", area: "Phuket", tags: ["wellness", "romance"], hours: 2, costPerPerson: 1800, kidFriendly: false, intensity: "easy", description: "Two-hour spa session in a garden setting." },
      { id: "th-market", title: "Weekend night market food crawl", area: "Phuket", tags: ["food", "shopping"], hours: 3, costPerPerson: 900, kidFriendly: true, intensity: "easy", description: "Street-food tasting and souvenir shopping." },
      { id: "th-zipline", title: "Jungle ziplining", area: "Phuket", tags: ["adventure", "nature"], hours: 3, costPerPerson: 3200, childCost: 2600, kidFriendly: true, intensity: "active", description: "Canopy zipline course with platforms and sky bridges." },
    ],
  },
  {
    id: "dubai",
    name: "Dubai",
    country: "United Arab Emirates",
    aliases: ["dubai", "uae", "abu dhabi", "emirates"],
    image: img("dubai"),
    tagline: "Skyline icons, desert safaris and theme parks",
    description:
      "A short flight from India, Dubai pairs record-breaking architecture with desert adventures, world-class malls and family theme parks.",
    bestMonths: [11, 12, 1, 2, 3],
    interests: ["shopping", "family_fun", "adventure", "nightlife", "food", "culture"],
    idealDays: [4, 6],
    flightEconomyPerPerson: 22000,
    arrivalAirport: "Dubai (DXB)",
    localTransportPerDay: 3500,
    mealsPerPersonPerDay: 2500,
    visaNote: "Demo note: most Indian travellers need a pre-arranged UAE visa. Verify current requirements before travel.",
    hotels: [
      { tier: "budget", name: "Deira 3★ city hotel (sample)", area: "Deira", nightlyRate: 4500, highlights: "Near metro and Gold Souk" },
      { tier: "midrange", name: "Downtown 4★ hotel (sample)", area: "Downtown", nightlyRate: 9500, highlights: "Walk to Dubai Mall and fountains" },
      { tier: "luxury", name: "Palm Jumeirah 5★ beach resort (sample)", area: "Palm Jumeirah", nightlyRate: 26000, highlights: "Private beach, water park access" },
    ],
    activities: [
      { id: "dxb-burj", title: "Burj Khalifa 'At the Top' & Dubai Fountain", area: "Downtown", tags: ["shopping", "family_fun", "romance"], hours: 3, costPerPerson: 3800, childCost: 3000, kidFriendly: true, intensity: "easy", description: "Level 124/125 observation decks and the evening fountain show." },
      { id: "dxb-safari", title: "Desert safari with BBQ dinner", area: "Desert", tags: ["adventure", "culture", "family_fun"], hours: 6, costPerPerson: 3200, childCost: 2600, kidFriendly: true, intensity: "moderate", description: "Dune bashing, sandboarding, camel ride and live shows." },
      { id: "dxb-souk", title: "Old Dubai, abra ride & souks", area: "Deira", tags: ["culture", "history", "shopping"], hours: 4, costPerPerson: 1500, kidFriendly: true, intensity: "easy", description: "Al Fahidi district, creek abra crossing and Gold & Spice Souks." },
      { id: "dxb-aquaventure", title: "Aquaventure water park", area: "Palm Jumeirah", tags: ["family_fun", "adventure", "beaches"], hours: 6, costPerPerson: 7200, childCost: 6000, kidFriendly: true, intensity: "moderate", description: "Record-breaking slides and a private beach." },
      { id: "dxb-frame", title: "Dubai Frame & Museum of the Future", area: "Zabeel", tags: ["culture", "family_fun"], hours: 4, costPerPerson: 4200, childCost: 3200, kidFriendly: true, intensity: "easy", description: "Two architectural icons with interactive exhibits." },
      { id: "dxb-dhow", title: "Marina dhow cruise dinner", area: "Dubai Marina", tags: ["romance", "food", "nightlife"], hours: 3, costPerPerson: 2800, childCost: 2000, kidFriendly: true, intensity: "easy", description: "Buffet dinner cruise past illuminated skyscrapers." },
      { id: "dxb-abudhabi", title: "Abu Dhabi day trip: Grand Mosque & Louvre", area: "Abu Dhabi", tags: ["culture", "history"], hours: 10, costPerPerson: 5500, childCost: 4200, kidFriendly: true, intensity: "moderate", description: "Sheikh Zayed Grand Mosque and Louvre Abu Dhabi." },
      { id: "dxb-miracle", title: "Miracle Garden & Global Village", area: "Dubailand", tags: ["family_fun", "shopping", "food"], hours: 5, costPerPerson: 2600, childCost: 2000, kidFriendly: true, intensity: "easy", description: "Seasonal flower garden and multicultural festival park (winter season)." },
      { id: "dxb-skydive", title: "Skydiving over the Palm", area: "Dubai Marina", tags: ["adventure"], hours: 4, costPerPerson: 52000, kidFriendly: false, intensity: "active", description: "Tandem skydive with views of Palm Jumeirah." },
      { id: "dxb-ifly", title: "Ski Dubai snow park", area: "Al Barsha", tags: ["family_fun", "adventure"], hours: 3, costPerPerson: 5200, childCost: 4600, kidFriendly: true, intensity: "moderate", description: "Indoor snow park with penguin encounters." },
    ],
  },
  {
    id: "singapore",
    name: "Singapore",
    country: "Singapore",
    aliases: ["singapore", "sentosa", "sg"],
    image: img("singapore"),
    tagline: "Gardens, theme parks and hawker food",
    description:
      "Clean, safe and compact, Singapore is a favourite for families: Sentosa's attractions, futuristic gardens and superb hawker centres.",
    bestMonths: [2, 3, 4, 5, 6, 7, 8, 9],
    interests: ["family_fun", "food", "shopping", "nature", "culture", "nightlife"],
    idealDays: [4, 6],
    flightEconomyPerPerson: 28000,
    arrivalAirport: "Singapore Changi (SIN)",
    localTransportPerDay: 3000,
    mealsPerPersonPerDay: 2200,
    visaNote: "Demo note: Indian passport holders generally need a Singapore visa arranged in advance. Verify current rules.",
    hotels: [
      { tier: "budget", name: "Little India 3★ hotel (sample)", area: "Little India", nightlyRate: 7000, highlights: "Near MRT, vegetarian food nearby" },
      { tier: "midrange", name: "Clarke Quay 4★ hotel (sample)", area: "Clarke Quay", nightlyRate: 12000, highlights: "Riverside, central location" },
      { tier: "luxury", name: "Sentosa 5★ resort (sample)", area: "Sentosa", nightlyRate: 28000, highlights: "Beachfront, near Universal Studios" },
    ],
    activities: [
      { id: "sg-uss", title: "Universal Studios Singapore", area: "Sentosa", tags: ["family_fun", "adventure"], hours: 8, costPerPerson: 5600, childCost: 4200, kidFriendly: true, intensity: "moderate", description: "Full-day theme park with rides for all ages." },
      { id: "sg-gardens", title: "Gardens by the Bay & Cloud Forest", area: "Marina Bay", tags: ["nature", "family_fun", "romance"], hours: 4, costPerPerson: 3000, childCost: 1900, kidFriendly: true, intensity: "easy", description: "Flower Dome, Cloud Forest and the evening Supertree light show." },
      { id: "sg-zoo", title: "Night Safari", area: "Mandai", tags: ["wildlife", "family_fun", "nature"], hours: 4, costPerPerson: 3600, childCost: 2500, kidFriendly: true, intensity: "easy", description: "The world's first nocturnal wildlife park, by tram and walking trails." },
      { id: "sg-sea", title: "S.E.A. Aquarium", area: "Sentosa", tags: ["wildlife", "family_fun"], hours: 3, costPerPerson: 2700, childCost: 2000, kidFriendly: true, intensity: "easy", description: "Huge marine aquarium with ocean-gallery viewing panel." },
      { id: "sg-hawker", title: "Hawker centre food trail", area: "Chinatown", tags: ["food", "culture"], hours: 3, costPerPerson: 1400, kidFriendly: true, intensity: "easy", description: "Guided tasting at heritage hawker stalls, vegetarian options available." },
      { id: "sg-mbs", title: "Marina Bay Sands SkyPark & Spectra show", area: "Marina Bay", tags: ["romance", "nightlife"], hours: 3, costPerPerson: 2200, childCost: 1700, kidFriendly: true, intensity: "easy", description: "Observation deck views and free waterfront light show." },
      { id: "sg-cable", title: "Sentosa cable car & Wings of Time", area: "Sentosa", tags: ["family_fun", "romance"], hours: 3, costPerPerson: 2600, childCost: 1900, kidFriendly: true, intensity: "easy", description: "Cable car ride and the night-time water show." },
      { id: "sg-heritage", title: "Chinatown, Little India & Kampong Glam walk", area: "City", tags: ["culture", "history", "shopping"], hours: 4, costPerPerson: 900, kidFriendly: true, intensity: "moderate", description: "Temples, shophouses and markets across three heritage districts." },
      { id: "sg-orchard", title: "Orchard Road shopping", area: "Orchard", tags: ["shopping"], hours: 4, costPerPerson: 0, kidFriendly: true, intensity: "easy", description: "Malls and flagship stores; budget your own spending." },
      { id: "sg-adventure", title: "Adventure Cove waterpark", area: "Sentosa", tags: ["family_fun", "beaches"], hours: 5, costPerPerson: 3100, childCost: 2400, kidFriendly: true, intensity: "moderate", description: "Water slides and snorkelling with tropical fish." },
    ],
  },
  {
    id: "maldives",
    name: "Maldives",
    country: "Maldives",
    aliases: ["maldives", "male"],
    image: img("maldives"),
    tagline: "Overwater villas and house reefs",
    description:
      "Ideal for honeymoons and slow travel: island resorts, lagoon snorkelling and spa days. Most time is spent at a single resort.",
    bestMonths: [11, 12, 1, 2, 3, 4],
    interests: ["beaches", "romance", "wellness", "wildlife", "adventure"],
    idealDays: [4, 6],
    flightEconomyPerPerson: 24000,
    arrivalAirport: "Velana International, Malé (MLE)",
    localTransportPerDay: 1500,
    mealsPerPersonPerDay: 6500,
    visaNote: "Demo note: tourist entry is usually granted on arrival with a confirmed resort booking. Verify current rules.",
    hotels: [
      { tier: "budget", name: "Maafushi guesthouse (sample)", area: "Maafushi", nightlyRate: 6500, highlights: "Local island, ferry access" },
      { tier: "midrange", name: "South Malé Atoll 4★ beach villa (sample)", area: "South Malé Atoll", nightlyRate: 22000, highlights: "Beach villa, house reef" },
      { tier: "luxury", name: "Overwater villa 5★ resort (sample)", area: "Ari Atoll", nightlyRate: 55000, highlights: "Overwater villa with lagoon access" },
    ],
    activities: [
      { id: "mv-snorkel", title: "House reef snorkelling session", area: "Resort", tags: ["wildlife", "beaches"], hours: 2, costPerPerson: 2500, kidFriendly: true, intensity: "moderate", description: "Guided snorkel with turtles and reef fish." },
      { id: "mv-dolphin", title: "Sunset dolphin cruise", area: "Resort", tags: ["wildlife", "romance"], hours: 2, costPerPerson: 5500, childCost: 3500, kidFriendly: true, intensity: "easy", description: "Traditional dhoni cruise to spot spinner dolphins." },
      { id: "mv-sandbank", title: "Private sandbank picnic", area: "Atoll", tags: ["romance", "beaches"], hours: 3, costPerPerson: 9000, kidFriendly: true, intensity: "easy", description: "Boat to a deserted sandbank with picnic lunch." },
      { id: "mv-spa", title: "Overwater spa ritual", area: "Resort", tags: ["wellness", "romance"], hours: 2, costPerPerson: 9500, kidFriendly: false, intensity: "easy", description: "Couples massage above the lagoon." },
      { id: "mv-dive", title: "Discover scuba diving", area: "Resort", tags: ["adventure", "wildlife"], hours: 3, costPerPerson: 11000, kidFriendly: false, intensity: "active", description: "Beginner dive with instructor (no certification needed)." },
      { id: "mv-whaleshark", title: "Whale shark & manta excursion", area: "South Ari Atoll", tags: ["wildlife", "adventure"], hours: 5, costPerPerson: 12500, kidFriendly: false, intensity: "moderate", description: "Seasonal snorkel trip for whale sharks and manta rays." },
      { id: "mv-island", title: "Local island & Malé city visit", area: "Malé", tags: ["culture", "shopping"], hours: 4, costPerPerson: 3000, kidFriendly: true, intensity: "easy", description: "Fish market, Old Friday Mosque and local cafés." },
      { id: "mv-kayak", title: "Lagoon kayaking & paddleboarding", area: "Resort", tags: ["adventure", "beaches", "family_fun"], hours: 2, costPerPerson: 2000, kidFriendly: true, intensity: "moderate", description: "Self-guided paddle in the calm lagoon." },
      { id: "mv-dinner", title: "Beach candlelight dinner", area: "Resort", tags: ["romance", "food"], hours: 2.5, costPerPerson: 8500, kidFriendly: false, intensity: "easy", description: "Private multi-course dinner on the sand." },
    ],
  },
  {
    id: "switzerland",
    name: "Switzerland",
    country: "Switzerland",
    aliases: ["switzerland", "swiss", "zurich", "interlaken", "lucerne", "zermatt", "alps"],
    image: img("switzerland"),
    tagline: "Alpine peaks, lakes and scenic trains",
    description:
      "Snow-capped peaks, glacier excursions and scenic rail journeys between Lucerne, Interlaken and Zermatt. Best with a Swiss Travel Pass.",
    bestMonths: [5, 6, 7, 8, 9, 12],
    interests: ["nature", "adventure", "romance", "culture", "family_fun"],
    idealDays: [6, 10],
    flightEconomyPerPerson: 58000,
    arrivalAirport: "Zurich (ZRH)",
    localTransportPerDay: 9000,
    mealsPerPersonPerDay: 5500,
    visaNote: "Demo note: Indian travellers need a Schengen visa; apply well in advance. Verify current rules.",
    hotels: [
      { tier: "budget", name: "Interlaken 3★ guesthouse (sample)", area: "Interlaken", nightlyRate: 13000, highlights: "Near Interlaken Ost station" },
      { tier: "midrange", name: "Lucerne 4★ lakeside hotel (sample)", area: "Lucerne", nightlyRate: 22000, highlights: "Lake views, old town nearby" },
      { tier: "luxury", name: "Zermatt 5★ chalet hotel (sample)", area: "Zermatt", nightlyRate: 48000, highlights: "Matterhorn views, spa" },
    ],
    activities: [
      { id: "ch-jungfrau", title: "Jungfraujoch – Top of Europe", area: "Interlaken", tags: ["nature", "adventure", "family_fun"], hours: 8, costPerPerson: 19000, childCost: 9500, kidFriendly: true, intensity: "moderate", description: "Cogwheel train to Europe's highest railway station and the Ice Palace." },
      { id: "ch-titlis", title: "Mount Titlis rotating cable car", area: "Engelberg", tags: ["nature", "adventure", "family_fun"], hours: 6, costPerPerson: 8500, childCost: 4300, kidFriendly: true, intensity: "moderate", description: "Rotair gondola, glacier cave and cliff walk." },
      { id: "ch-lucerne", title: "Lucerne old town & Chapel Bridge walk", area: "Lucerne", tags: ["culture", "history", "romance"], hours: 3, costPerPerson: 0, kidFriendly: true, intensity: "easy", description: "Self-guided walk through medieval lanes and the lakefront." },
      { id: "ch-lakecruise", title: "Lake Lucerne cruise", area: "Lucerne", tags: ["nature", "romance"], hours: 3, costPerPerson: 5200, childCost: 2600, kidFriendly: true, intensity: "easy", description: "Paddle steamer cruise with mountain panoramas." },
      { id: "ch-paraglide", title: "Tandem paragliding over Interlaken", area: "Interlaken", tags: ["adventure"], hours: 2.5, costPerPerson: 16000, kidFriendly: false, intensity: "active", description: "Glide between Lake Thun and Lake Brienz." },
      { id: "ch-glacier", title: "Glacier Express scenic train (section)", area: "Zermatt", tags: ["nature", "romance"], hours: 6, costPerPerson: 14000, childCost: 7000, kidFriendly: true, intensity: "easy", description: "Panoramic rail journey through the Alps." },
      { id: "ch-gornergrat", title: "Gornergrat railway & Matterhorn views", area: "Zermatt", tags: ["nature", "family_fun"], hours: 4, costPerPerson: 10500, childCost: 5300, kidFriendly: true, intensity: "easy", description: "Cog railway to a viewpoint facing the Matterhorn." },
      { id: "ch-chocolate", title: "Swiss chocolate workshop", area: "Lucerne", tags: ["food", "family_fun"], hours: 2, costPerPerson: 6500, childCost: 4500, kidFriendly: true, intensity: "easy", description: "Make your own chocolate bars with a chocolatier." },
      { id: "ch-harder", title: "Harder Kulm funicular sunset", area: "Interlaken", tags: ["nature", "romance"], hours: 2, costPerPerson: 3600, childCost: 1800, kidFriendly: true, intensity: "easy", description: "Short funicular to the Two Lakes viewpoint." },
      { id: "ch-rhine", title: "Rhine Falls & Zurich old town", area: "Zurich", tags: ["nature", "culture"], hours: 6, costPerPerson: 4800, childCost: 2400, kidFriendly: true, intensity: "easy", description: "Europe's largest plain waterfall and a stroll through Zurich." },
    ],
  },
  {
    id: "vietnam",
    name: "Vietnam",
    country: "Vietnam",
    aliases: ["vietnam", "hanoi", "ha long", "halong", "da nang", "hoi an", "ho chi minh", "saigon"],
    image: img("vietnam"),
    tagline: "Bays, lantern towns and great value",
    description:
      "Excellent value: Ha Long Bay cruises, Hoi An's lantern-lit old town, Da Nang beaches and outstanding street food.",
    bestMonths: [2, 3, 4, 10, 11, 12],
    interests: ["culture", "food", "nature", "history", "beaches", "adventure"],
    idealDays: [6, 9],
    flightEconomyPerPerson: 30000,
    arrivalAirport: "Hanoi (HAN) / Da Nang (DAD)",
    localTransportPerDay: 2500,
    mealsPerPersonPerDay: 1300,
    visaNote: "Demo note: Indian travellers can usually apply for an e-visa online. Verify current rules.",
    hotels: [
      { tier: "budget", name: "Hanoi Old Quarter 3★ hotel (sample)", area: "Hanoi", nightlyRate: 2800, highlights: "Walk to Hoan Kiem Lake" },
      { tier: "midrange", name: "Hoi An 4★ riverside resort (sample)", area: "Hoi An", nightlyRate: 5500, highlights: "Pool, bicycles included" },
      { tier: "luxury", name: "Da Nang 5★ beach resort (sample)", area: "Da Nang", nightlyRate: 15000, highlights: "Beachfront with spa" },
    ],
    activities: [
      { id: "vn-halong", title: "Ha Long Bay day cruise", area: "Ha Long", tags: ["nature", "adventure"], hours: 10, costPerPerson: 5200, childCost: 3900, kidFriendly: true, intensity: "easy", description: "Cruise among limestone karsts with kayaking and cave visit." },
      { id: "vn-hoian", title: "Hoi An ancient town & lantern night", area: "Hoi An", tags: ["culture", "history", "romance"], hours: 4, costPerPerson: 1200, kidFriendly: true, intensity: "easy", description: "UNESCO old town, tailor shops and riverside lanterns." },
      { id: "vn-goldenbridge", title: "Ba Na Hills & Golden Bridge", area: "Da Nang", tags: ["nature", "family_fun"], hours: 8, costPerPerson: 5000, childCost: 4000, kidFriendly: true, intensity: "easy", description: "Cable car to the famous 'giant hands' bridge." },
      { id: "vn-streetfood", title: "Hanoi street food walking tour", area: "Hanoi", tags: ["food", "culture"], hours: 3, costPerPerson: 1800, kidFriendly: true, intensity: "easy", description: "Pho, bun cha and egg coffee with a local guide." },
      { id: "vn-cuchi", title: "Cu Chi Tunnels", area: "Ho Chi Minh City", tags: ["history", "adventure"], hours: 5, costPerPerson: 2200, kidFriendly: true, intensity: "moderate", description: "Wartime tunnel network with guided explanations." },
      { id: "vn-mekong", title: "Mekong Delta boat trip", area: "Mekong", tags: ["nature", "culture", "food"], hours: 8, costPerPerson: 3000, kidFriendly: true, intensity: "easy", description: "Floating markets, coconut workshops and sampan rides." },
      { id: "vn-myson", title: "My Son Sanctuary ruins", area: "Hoi An", tags: ["history", "culture"], hours: 5, costPerPerson: 1900, kidFriendly: true, intensity: "moderate", description: "Ancient Cham temple complex in the jungle." },
      { id: "vn-beach", title: "My Khe beach afternoon", area: "Da Nang", tags: ["beaches", "family_fun"], hours: 3, costPerPerson: 0, kidFriendly: true, intensity: "easy", description: "Wide sandy beach popular for swimming at sunset." },
      { id: "vn-cooking", title: "Hoi An basket boat & cooking class", area: "Hoi An", tags: ["food", "family_fun"], hours: 5, costPerPerson: 2600, kidFriendly: true, intensity: "easy", description: "Coconut-forest basket boat ride and cooking lesson." },
      { id: "vn-ninhbinh", title: "Ninh Binh & Trang An boat ride", area: "Ninh Binh", tags: ["nature", "history"], hours: 9, costPerPerson: 3600, kidFriendly: true, intensity: "moderate", description: "Rowing boats through caves and rice paddies." },
    ],
  },
  {
    id: "japan",
    name: "Japan (Tokyo & Kyoto)",
    country: "Japan",
    aliases: ["japan", "tokyo", "kyoto", "osaka", "mount fuji", "fuji"],
    image: img("japan"),
    tagline: "Neon cities, temples and bullet trains",
    description:
      "Tokyo's energy, Kyoto's temples and Mount Fuji views, connected by efficient trains. Spring (cherry blossom) and autumn are peak seasons.",
    bestMonths: [3, 4, 5, 10, 11],
    interests: ["culture", "food", "shopping", "history", "nature", "family_fun"],
    idealDays: [7, 10],
    flightEconomyPerPerson: 55000,
    arrivalAirport: "Tokyo Narita (NRT) / Haneda (HND)",
    localTransportPerDay: 6000,
    mealsPerPersonPerDay: 3200,
    visaNote: "Demo note: Indian travellers need a Japan visa; e-visa options exist in some cases. Verify current rules.",
    hotels: [
      { tier: "budget", name: "Asakusa 3★ business hotel (sample)", area: "Tokyo", nightlyRate: 8000, highlights: "Compact rooms, near Senso-ji" },
      { tier: "midrange", name: "Shinjuku 4★ hotel (sample)", area: "Tokyo", nightlyRate: 14000, highlights: "Central, near JR station" },
      { tier: "luxury", name: "Kyoto 5★ ryokan-style hotel (sample)", area: "Kyoto", nightlyRate: 38000, highlights: "Onsen, kaiseki dinner" },
    ],
    activities: [
      { id: "jp-sensoji", title: "Asakusa & Senso-ji temple", area: "Tokyo", tags: ["culture", "history", "shopping"], hours: 3, costPerPerson: 0, kidFriendly: true, intensity: "easy", description: "Tokyo's oldest temple and Nakamise shopping street." },
      { id: "jp-shibuya", title: "Shibuya crossing & Shibuya Sky", area: "Tokyo", tags: ["nightlife", "shopping"], hours: 3, costPerPerson: 1300, kidFriendly: true, intensity: "easy", description: "The world's busiest crossing and a rooftop observation deck." },
      { id: "jp-teamlab", title: "teamLab Planets digital art", area: "Tokyo", tags: ["family_fun", "culture"], hours: 2.5, costPerPerson: 2200, childCost: 1500, kidFriendly: true, intensity: "easy", description: "Immersive art museum you walk through barefoot." },
      { id: "jp-disney", title: "Tokyo DisneySea", area: "Tokyo", tags: ["family_fun"], hours: 9, costPerPerson: 5200, childCost: 3200, kidFriendly: true, intensity: "moderate", description: "Full-day theme park, unique to Tokyo." },
      { id: "jp-fuji", title: "Mount Fuji & Lake Kawaguchi day trip", area: "Fuji", tags: ["nature"], hours: 10, costPerPerson: 7000, childCost: 5000, kidFriendly: true, intensity: "moderate", description: "Fuji Five Lakes views, pagoda and lakeside town." },
      { id: "jp-fushimi", title: "Fushimi Inari torii gates", area: "Kyoto", tags: ["culture", "history", "nature"], hours: 3, costPerPerson: 0, kidFriendly: true, intensity: "moderate", description: "Thousands of vermilion gates up the mountainside." },
      { id: "jp-arashiyama", title: "Arashiyama bamboo grove & monkey park", area: "Kyoto", tags: ["nature", "wildlife"], hours: 4, costPerPerson: 600, kidFriendly: true, intensity: "moderate", description: "Bamboo forest walk and riverside temples." },
      { id: "jp-tea", title: "Kyoto tea ceremony & kimono experience", area: "Kyoto", tags: ["culture", "romance"], hours: 2, costPerPerson: 4800, kidFriendly: true, intensity: "easy", description: "Traditional matcha ceremony in a machiya house." },
      { id: "jp-nara", title: "Nara deer park & Todai-ji", area: "Nara", tags: ["wildlife", "history", "family_fun"], hours: 5, costPerPerson: 1200, kidFriendly: true, intensity: "easy", description: "Friendly deer and the giant bronze Buddha." },
      { id: "jp-food", title: "Tsukiji outer market food tour", area: "Tokyo", tags: ["food"], hours: 3, costPerPerson: 6000, kidFriendly: true, intensity: "easy", description: "Guided tasting of street snacks; ask for vegetarian options." },
      { id: "jp-onsen", title: "Hakone onsen day", area: "Hakone", tags: ["wellness", "nature"], hours: 8, costPerPerson: 6500, childCost: 4000, kidFriendly: true, intensity: "easy", description: "Hot springs, ropeway and Lake Ashi cruise." },
    ],
  },
];

export function getDestination(id: string | null | undefined): Destination | undefined {
  if (!id) return undefined;
  return DESTINATIONS.find((d) => d.id === id);
}

export function listDestinationSummaries() {
  return DESTINATIONS.map((d) => ({
    id: d.id,
    name: d.name,
    country: d.country,
    image: d.image,
    tagline: d.tagline,
    description: d.description,
    bestMonths: d.bestMonths,
    interests: d.interests,
    idealDays: d.idealDays,
    visaNote: d.visaNote,
    fromPricePerPerson: estimateFromPrice(d),
  }));
}

/** Rough "from" price per person for a 5-day midrange trip incl. flights. */
export function estimateFromPrice(d: Destination): number {
  const days = 5;
  const nights = days - 1;
  const hotel = d.hotels.find((h) => h.tier === "midrange")?.nightlyRate ?? 0;
  const perPerson =
    d.flightEconomyPerPerson +
    (hotel * nights) / 2 +
    d.mealsPerPersonPerDay * days +
    (d.localTransportPerDay * days) / 2;
  return Math.round(perPerson / 1000) * 1000;
}
