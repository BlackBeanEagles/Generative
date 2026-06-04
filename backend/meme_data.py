# Maps each expression to a prioritized list of Imgflip template names to search for.
# Backend resolves these against the live Imgflip template catalog at startup.
EXPRESSION_MEME_NAMES = {
    "happy": [
        "Drake Hotline Bling",
        "Success Kid",
        "Oprah You Get A",
        "But That's None Of My Business",
    ],
    "surprised": [
        "Surprised Pikachu",
        "Blinking White Guy",
        "Wait That's Illegal",
        "I was told there would be",
    ],
    "sad": [
        "First World Problems",
        "This Is Fine",
        "Hide the Pain Harold",
        "Crying Jordan",
    ],
    "angry": [
        "Change My Mind",
        "Sparta Leonidas",
        "Angry Baby",
        "Table Flip",
    ],
    "disgusted": [
        "Mocking Spongebob",
        "Disaster Girl",
        "Eww I Stepped In Something",
        "Woman Yelling At Cat",
    ],
    "fearful": [
        "Ancient Aliens",
        "Roll Safe Think About It",
        "That Would Be Great",
        "Sleeping Shaq",
    ],
    "neutral": [
        "Two Buttons",
        "Fry Not Sure",
        "One Does Not Simply",
        "X, X Everywhere",
    ],
}

# Keep style metadata for the history strip / fallback card colors per expression
EXPRESSION_COLORS = {
    "happy":     {"accent": "#FFD700", "bg": "#1a1200"},
    "surprised": {"accent": "#FF69B4", "bg": "#1a0010"},
    "sad":       {"accent": "#4169E1", "bg": "#000a1a"},
    "angry":     {"accent": "#DC143C", "bg": "#1a0000"},
    "disgusted": {"accent": "#6B8E23", "bg": "#050d00"},
    "fearful":   {"accent": "#9370DB", "bg": "#0d001a"},
    "neutral":   {"accent": "#708090", "bg": "#0d0d0d"},
}
