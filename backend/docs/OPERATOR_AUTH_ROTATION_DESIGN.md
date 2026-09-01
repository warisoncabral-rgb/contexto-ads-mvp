# Operator authentication rotation

The bootstrap operator identity may accept one primary credential and one optional secondary SHA-256 digest during controlled rotation. The secondary digest is a verifier only; the raw secret remains outside the repository. Existing primary authentication remains valid until the rotation is explicitly completed.
