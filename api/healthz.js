module.exports = function healthz(req, res) {
	const payload = {
		ok: true,
		timestamp: new Date().toISOString(),
		host: req.headers.host || null,
		deployment: {
			environment: process.env.VERCEL_ENV || null,
			url: process.env.VERCEL_URL || null,
			region: process.env.VERCEL_REGION || null,
			commitSha: process.env.VERCEL_GIT_COMMIT_SHA || null,
			commitRef: process.env.VERCEL_GIT_COMMIT_REF || null,
			commitMessage: process.env.VERCEL_GIT_COMMIT_MESSAGE || null
		}
	};

	res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
	res.setHeader("Pragma", "no-cache");
	res.setHeader("Expires", "0");
	res.statusCode = 200;
	res.setHeader("Content-Type", "application/json; charset=utf-8");
	res.end(JSON.stringify(payload, null, 2));
};
