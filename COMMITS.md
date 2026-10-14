# Commit manifest (step 4)
Every replay's own commit is in shadow/own_commit.json (43 originals) and shadow/new100_commit.json.
The 618 games matched to a shared build are recorded in exact_match_state.json; their own commits are in their .json inputlog.
Rule: one build per commit, keyed by commit hash, and record the commit in every dataset row.
