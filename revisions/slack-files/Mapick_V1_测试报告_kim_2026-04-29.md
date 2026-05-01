<!DOCTYPE html><html lang="en-US" class="" data-primer data-cdn="https://a.slack-edge.com/"><head><script>

(function () {
	
	var data;

	const MAX_CDN_FALLBACK = 2;
	let isReloading = false;

	function scanPageAssets() {
		var css = document.getElementsByTagName('link');
		var script = document.getElementsByTagName('script');
		var i;
		var j;

		
		var cdn_domain = 'slack-edge.com';

		
		var domains = location.hostname && location.hostname.split('.');

		const isDev =
			(domains && domains.length && domains[0] && domains[0].match(/dev[0-9]+/i)) ||
			(domains[1] && domains[1].match(/dev[0-9]+/i));

		
		if (isDev) {
			cdn_domain = location.hostname;
		}

		for (i = 0, j = css.length; i < j; i += 1) {
			if (
				css[i].rel === 'stylesheet' &&
				css[i].href &&
				(!cdn_domain || css[i].href.indexOf(cdn_domain) !== -1)
			)
				count(css[i]);
		}

		for (i = 0, j = script.length; i < j; i += 1) {
			if (script[i].src && (!cdn_domain || script[i].src.indexOf(cdn_domain) !== -1))
				count(script[i]);
		}

		
		check();
	}

	function reset() {
		data = {
			node_count: 0,
			known_nodes: [],
			processed_nodes: [],
			processed_count: 0,
			loaded: [],
			failed: [],
		};
	}

	function isRelevantNode(node) {
		if (!node) return;
		
		if (!node.onload || !node.onerror) return false;
		
		if (node.href && node.rel && node.rel === 'stylesheet') return true;
		
		if (node.src && node.nodeName.toLowerCase() === 'script') return true;
		
		return false;
	}

	function getURL(node) {
		if (!node) return;
		
		return node.href || node.src;
	}

	function process(node) {
		var src = getURL(node);
		if (!src) return;
		
		if (data.processed_nodes[src]) return;
		data.processed_nodes[src] = true;
		return true;
	}

	function ok(node, args) {
		if (!process(node)) return;
		data.processed_count += 1;
		data.loaded.push({
			node: node,
			args: args,
		});
		check();
	}

	function failed(node, args) {
		if (!process(node)) return;
		data.processed_count += 1;
		data.failed.push({
			node: node,
			args: args,
		});
		
		(
			(window.TS && TS.console && TS.console.error && TS.console.error) ||
			window.console.error ||
			function () {}
		)('CDN asset failed to load: ' + getURL(node));
		check();
	}

	function count(node) {
		if (!node) return;
		if (!isRelevantNode(node)) return;
		var url = getURL(node);
		if (!url) return;
		if (data.known_nodes[url]) return;
		data.known_nodes[url] = true;
		data.node_count += 1;
	}

	function check() {
		if (!data.processed_count) return;
		var missing = false;
		var missing_nodes = [];
		var all_count = 0;
		for (var item in data.known_nodes) {
			if (!data.known_nodes.hasOwnProperty(item)) continue;
			all_count += 1;
			if (!data.processed_nodes[item]) {
				missing_nodes.push(item);
				missing = true;
			}
		}

		
		if (!all_count) return;

		
		if (missing) return;

		
		if (!data.failed.length) {
			if (window.console) console.log(data.loaded.length + ' CDN assets loaded OK');
			reset();
			return;
		}

		
		var i;
		var j = data.failed.length;
		var failed = [];
		var failed_css = 0;
		var failed_js = 0;
		var node_name;

		for (i = 0; i < j; i += 1) {
			failed.push(getURL(data.failed[i].node));
			node_name = data.failed[i].node.nodeName.toLowerCase();
			if (node_name === 'link') failed_css += 1;
			if (node_name === 'script') failed_js += 1;
		}

		if (window.console && console.error) {
			console.error(data.failed.length + ' CDN assets failed to load: ' + failed.join(', '));
		}

		if (window.TSBeacon) {
			if (failed_css) window.TSBeacon('cdn_load_tracking_failed_css', failed_css);
			if (failed_js) window.TSBeacon('cdn_load_tracking_failed_js', failed_js);
		}

		if (isReloading) {
			if (window.console) {
				console.warn(
					'[RELOAD] Detected more issues loading assets, but we are already preparing to reload so no need to do anything',
				);
			}
			return;
		}

		const params = new URLSearchParams(location.search);
		let cdnFallbackCount = parseInt(params.get('cdn_fallback'), 10) || 0;
		cdnFallbackCount += 1;

		if (cdnFallbackCount > MAX_CDN_FALLBACK) {
			if (window.console) {
				console.warn("[RELOAD] Hit maximum reload attempts, won't try reloading anymore");
			}
			return;
		}

		isReloading = true;
		params.set('cdn_fallback', cdnFallbackCount.toString());

		
		const newSearch = params.toString();
		if (window.console) console.warn(`[RELOAD] Reloading client with URL: ${newSearch}`);

		
		let timeout;
		const reload = () => {
			console.warn(`[RELOAD] Reloading client with URL: ${newSearch}`);
			window.clearTimeout(timeout);
			window.location.search = newSearch;
		};
		timeout = window.setTimeout(reload.bind(this), 5000);

		const preReloadPromises = [];

		
		
		
		
		if (window.desktop?.stats?.clearCache) {
			preReloadPromises.push(
				new Promise((resolve) => {
					try {
						console.warn('[RELOAD] Attempting to clear desktop cache');
						window.desktop.stats.clearCache().then(() => {
							console.warn('[RELOAD] Successfully cleared desktop cache');
							resolve();
						});
					} catch (e) {
						console.warn(
							`[RELOAD] Error clearing desktop cache: ${!!e && typeof e === 'object' && 'message' in e ? e.message : 'Unknown error'}`,
						);
						resolve();
					}
				}),
			);
		}

		Promise.all(preReloadPromises).then(reload);
	}

	reset();

	window._cdn = {
		check: check,
		count: count,
		data: data,
		ok: ok,
		failed: failed,
		scanPageAssets: scanPageAssets,
	};
})();
</script><link href="https://a.slack-edge.com/bv1-13/marketing-style-onetrust-banner.80ccb99235027e6690e3.min.css" rel="stylesheet" type="text/css" onload="window._cdn ? _cdn.ok(this, arguments) : null" onerror="window._cdn ? _cdn.failed(this, arguments) : null" crossorigin="anonymous"><link href="https://a.slack-edge.com/bv1-13/legacy-style-libs-lato-2-compressed.b4a5b5cd94ce5aee6359.min.css" rel="stylesheet" type="text/css" onload="window._cdn ? _cdn.ok(this, arguments) : null" onerror="window._cdn ? _cdn.failed(this, arguments) : null" crossorigin="anonymous"><link href="https://a.slack-edge.com/bv1-13/marketing-style-generic-typography-avantgarde.e5bf1218673e1b980835.min.css" rel="stylesheet" type="text/css" onload="window._cdn ? _cdn.ok(this, arguments) : null" onerror="window._cdn ? _cdn.failed(this, arguments) : null" crossorigin="anonymous"><link href="https://a.slack-edge.com/bv1-13/marketing-style-generic-typography-sfsans.663a8f35624c9f33608d.min.css" rel="stylesheet" type="text/css" onload="window._cdn ? _cdn.ok(this, arguments) : null" onerror="window._cdn ? _cdn.failed(this, arguments) : null" crossorigin="anonymous"><link rel="canonical" href="https://slack.com">

<link rel="alternate" hreflang="en-us" href="https://slack.com">

<link rel="alternate" hreflang="en-au" href="https://slack.com/intl/en-au">

<link rel="alternate" hreflang="en-gb" href="https://slack.com/intl/en-gb">

<link rel="alternate" hreflang="en-in" href="https://slack.com/intl/en-in">

<link rel="alternate" hreflang="fr-ca" href="https://slack.com/intl/fr-ca">

<link rel="alternate" hreflang="fr-fr" href="https://slack.com/intl/fr-fr">

<link rel="alternate" hreflang="de-de" href="https://slack.com/intl/de-de">

<link rel="alternate" hreflang="es-es" href="https://slack.com/intl/es-es">

<link rel="alternate" hreflang="es" href="https://slack.com/intl/es-la">

<link rel="alternate" hreflang="ja-jp" href="https://slack.com/intl/ja-jp">

<link rel="alternate" hreflang="pt-br" href="https://slack.com/intl/pt-br">

<link rel="alternate" hreflang="ko-kr" href="https://slack.com/intl/ko-kr">

<link rel="alternate" hreflang="it-it" href="https://slack.com/intl/it-it">

<link rel="alternate" hreflang="zh-cn" href="https://slack.com/intl/zh-cn">

<link rel="alternate" hreflang="zh-tw" href="https://slack.com/intl/zh-tw">

<link rel="alternate" hreflang="x-default" href="https://slack.com">

<script>window.ts_endpoint_url = "https:\/\/slack.com\/beacon\/timing";(function(e) {
	var n=Date.now?Date.now():+new Date,r=e.performance||{},t=[],a={},i=function(e,n){for(var r=0,a=t.length,i=[];a>r;r++)t[r][e]==n&&i.push(t[r]);return i},o=function(e,n){for(var r,a=t.length;a--;)r=t[a],r.entryType!=e||void 0!==n&&r.name!=n||t.splice(a,1)};r.now||(r.now=r.webkitNow||r.mozNow||r.msNow||function(){return(Date.now?Date.now():+new Date)-n}),r.mark||(r.mark=r.webkitMark||function(e){var n={name:e,entryType:"mark",startTime:r.now(),duration:0};t.push(n),a[e]=n}),r.measure||(r.measure=r.webkitMeasure||function(e,n,r){n=a[n].startTime,r=a[r].startTime,t.push({name:e,entryType:"measure",startTime:n,duration:r-n})}),r.getEntriesByType||(r.getEntriesByType=r.webkitGetEntriesByType||function(e){return i("entryType",e)}),r.getEntriesByName||(r.getEntriesByName=r.webkitGetEntriesByName||function(e){return i("name",e)}),r.clearMarks||(r.clearMarks=r.webkitClearMarks||function(e){o("mark",e)}),r.clearMeasures||(r.clearMeasures=r.webkitClearMeasures||function(e){o("measure",e)}),e.performance=r,"function"==typeof define&&(define.amd||define.ajs)&&define("performance",[],function(){return r}) // eslint-disable-line
})(window);</script><script>

(function () {
	
	window.TSMark = function (mark_label) {
		if (!window.performance || !window.performance.mark) return;
		performance.mark(mark_label);
	};
	window.TSMark('start_load');

	
	window.TSMeasureAndBeacon = function (measure_label, start_mark_label) {
		if (!window.performance || !window.performance.mark || !window.performance.measure) {
			return;
		}

		performance.mark(start_mark_label + '_end');

		try {
			performance.measure(measure_label, start_mark_label, start_mark_label + '_end');
			window.TSBeacon(measure_label, performance.getEntriesByName(measure_label)[0].duration);
		} catch (e) {
			
		}
	};

	
	if ('sendBeacon' in navigator) {
		window.TSBeacon = function (label, value) {
			var endpoint_url = window.ts_endpoint_url || 'https://slack.com/beacon/timing';
			navigator.sendBeacon(
				endpoint_url + '?data=' + encodeURIComponent(label + ':' + value),
				'',
			);
		};
	} else {
		window.TSBeacon = function (label, value) {
			var endpoint_url = window.ts_endpoint_url || 'https://slack.com/beacon/timing';
			new Image().src = endpoint_url + '?data=' + encodeURIComponent(label + ':' + value);
		};
	}
})();
</script><script>window.TSMark('step_load');</script><script>
(function () {
	function throttle(callback, intervalMs) {
		var wait = false;

		return function () {
			if (!wait) {
				callback.apply(null, arguments);
				wait = true;
				setTimeout(function () {
					wait = false;
				}, intervalMs);
			}
		};
	}

	function getGenericLogger() {
		return {
			warn: (msg) => {
				
				if (window.console && console.warn) return console.warn(msg);
			},
			error: (msg) => {
				if (!msg) return;

				if (window.TSBeacon) return window.TSBeacon(msg, 1);

				
				if (window.console && console.warn) return console.warn(msg);
			},
		};
	}

	function globalErrorHandler(evt) {
		if (!evt) return;

		
		var details = '';

		var node = evt.srcElement || evt.target;

		var genericLogger = getGenericLogger();

		
		
		
		
		if (node && node.nodeName) {
			var nodeSrc = '';
			if (node.nodeName === 'SCRIPT') {
				nodeSrc = node.src || 'unknown';
				var errorType = evt.type || 'error';

				
				details = `[${errorType}] from script at ${nodeSrc} (failed to load?)`;
			} else if (node.nodeName === 'IMG') {
				nodeSrc = node.src || node.currentSrc;

				genericLogger.warn(`<img> fired error with url = ${nodeSrc}`);
				return;
			}
		}

		
		if (evt.error && evt.error.stack) {
			details += ` ${evt.error.stack}`;
		}

		if (evt.filename) {
			
			var fileName = evt.filename;
			var lineNo = evt.lineno;
			var colNo = evt.colno;

			details += ` from ${fileName}`;

			
			if (lineNo) {
				details += ` @ line ${lineNo}, col ${colNo}`;
			}
		}

		var msg;

		
		if (evt.error && evt.error.stack) {
			
			msg = details;
		} else {
			
			msg = `${evt.message || ''} ${details}`;
		}

		
		if (msg && msg.replace) msg = msg.replace(/\s+/g, ' ').trim();

		if (!msg || !msg.length) {
			if (node) {
				var nodeName = node.nodeName || 'unknown';

				
				
				
				if (nodeName === 'VIDEO') {
					return;
				}

				msg = `error event from node of ${nodeName}, no message provided?`;
			} else {
				msg = 'error event fired, no relevant message or node found';
			}
		}

		var logPrefix = 'ERROR caught in js/inline/register_global_error_handler';

		msg = `${logPrefix} - ${msg}`;

		genericLogger.error(msg);
	}

	
	
	
	var capture = true;

	
	var throttledHandler = throttle(globalErrorHandler, 10000);

	window.addEventListener('error', throttledHandler, capture);
})();
</script><script type="text/javascript" crossorigin="anonymous" src="https://a.slack-edge.com/bv1-13/manifest.3fc19b31869bc96a76e7.primer.min.js" onload="window._cdn ? _cdn.ok(this, arguments) : null" onerror="window._cdn ? _cdn.failed(this, arguments) : null"></script><noscript><meta http-equiv="refresh" content="0; URL=/?redir=%2Ffiles-pri%2FT017G7L7A2H-F0B0K2M7U82%2Fdownload%2Fmapick_v1______________kim_2026-04-29.md&amp;nojsmode=1"></noscript><script type="text/javascript">var safe_hosts = ["app.optimizely.com","tinyspeck.dev.slack.com","houston-dev.tinyspeck.com","houston.tinyspeck.com"];

if (self !== top && safe_hosts.indexOf(top.location.host) === -1) {
	window.document.write(
		'\u003Cstyle>body * {display:none !important;}\u003C/style>\u003Ca href="#" onclick=' +
			'"top.location.href=window.location.href" style="display:block !important;padding:10px">Go to Slack.com\u003C/a>'
	);
}

(function() {
	var timer;
	if (self !== top && safe_hosts.indexOf(top.location.host) === -1) {
		timer = window.setInterval(function() {
			if (window) {
				try {
					var pageEl = document.getElementById('page');
					var clientEl = document.getElementById('client-ui');
					var sectionEls = document.querySelectorAll('nav, header, section');

					pageEl.parentNode.removeChild(pageEl);
					clientEl.parentNode.removeChild(clientEl);
					for (var i = 0; i < sectionEls.length; i++) {
						sectionEls[i].parentNode.removeChild(sectionEls[i]);
					}
					window.TS = null;
					window.TD = null;
					window.clearInterval(timer);
				} catch (e) {}
			}
		}, 200);
	}
})();</script><script>window.GA = window.GA || {};
window.GA.boot_data = window.GA.boot_data || {};
GA.boot_data.xhp = true;
GA.boot_data.version_uid = "90a3ed4b9d9ce5794c493d9d0e5588e6733bdd5a";
GA.boot_data.environment = "prod";
GA.boot_data.abs_root_url = "https:\/\/slack.com\/";
GA.boot_data.document_referrer = "";

GA.boot_data.anonymous_visitor = false;
GA.boot_data.beacon_timing_url = "https:\/\/slack.com\/beacon\/timing";
GA.boot_data.referral_code = "";
GA.boot_data.auth_cookie_domain = ".slack.com";

GA.boot_data.geo = {"ip":"103.142.140.57","country":"SG","is_in_european_union":false,"region":"","city":"Singapore","zip":"17","lat":1.2872,"lon":103.8507,"metro":0,"country_label":"Singapore","region_label":"","country3":"SGP","continent":"AS","isp":"Kirino"};
GA.boot_data.geocode = "en-sg";
GA.boot_data.intl_prefix = "\/intl\/en-sg";
GA.boot_data.request_uri = "\/?redir=%2Ffiles-pri%2FT017G7L7A2H-F0B0K2M7U82%2Fdownload%2Fmapick_v1______________kim_2026-04-29.md";
GA.boot_data.canonical_web_url = "https:\/\/slack.com\/";
GA.boot_data.i18n_locale = "en-US";
GA.boot_data.geo_root_url = "https:\/\/slack.com\/intl\/en-sg\/";

GA.boot_data.is_usa = false;
GA.boot_data.is_spain = false;
GA.boot_data.is_germany = false;
GA.boot_data.is_france = false;
GA.boot_data.is_japan = false;
GA.boot_data.is_europe = false;

GA.boot_data.is_latam = false;
GA.boot_data.is_brazil = false;
GA.boot_data.is_india = false;
GA.boot_data.is_uk = false;

GA.boot_data.is_english = true;
GA.boot_data.is_spanish = false;
GA.boot_data.is_german = false;
GA.boot_data.is_french = false;
GA.boot_data.is_japanese = false;
GA.boot_data.is_portuguese = false;

GA.boot_data.job_board_token = "slack";
GA.boot_data.zd_locale = "en-us";
</script><meta name="facebook-domain-verification" content="chiwsajpoybn2cnqyj9w8mvrey56m0"><script type="text/javascript">
document.addEventListener("DOMContentLoaded", function(e) {
	var gtmDataLayer = window.dataLayer || [];
	var gtmTags = document.querySelectorAll('*[data-gtm-click]');
	var gtmClickHandler = function(c) {
		var gtm_events = this.getAttribute('data-gtm-click');
		if (!gtm_events) return;
		var gtm_events_arr = gtm_events.split(",");
		for(var e=0; e < gtm_events_arr.length; e++) {
			var ev = gtm_events_arr[e].trim();
			gtmDataLayer.push({ 'event': ev });
		}
	};
	for(var g=0; g < gtmTags.length; g++){
		var elem = gtmTags[g];
		elem.addEventListener('click', gtmClickHandler);
	}
});
</script><script type="text/javascript">
(function(e,c,b,f,d,g,a){e.SlackBeaconObject=d;
e[d]=e[d]||function(){(e[d].q=e[d].q||[]).push([1*new Date(),arguments])};
e[d].l=1*new Date();g=c.createElement(b);a=c.getElementsByTagName(b)[0];
g.async=1;g.src=f;a.parentNode.insertBefore(g,a)
})(window,document,"script","https://a.slack-edge.com/bv1-13/slack_beacon.c3374fa3995d87aed397.min.js","sb");
window.sb('set', 'token', '3307f436963e02d4f9eb85ce5159744c');
window.sb('track', 'pageview');
</script><script src="https://cdn.cookielaw.org/scripttemplates/otSDKStub.js" data-document-language="true" data-domain-script="3bcd90cf-1e32-46d7-adbd-634f66b65b7d"></script><script>window.OneTrustLoaded = true;</script><script>
window.dataLayer = window.dataLayer || [];

function afterConsentScripts() {
	window.TD.analytics.doPush();

	const bottomBannerEl = document.querySelector('.c-announcement-banner-bottom');
	if (bottomBannerEl !== null) {
		bottomBannerEl.classList.remove('c-announcement-banner-bottom-invisible');
	}
}



function toNumberSet(value) {
    let arr;
    arr = value.split(',');

    let set = {};
    for (let i = 1; i < arr.length; i++) {
      let n = parseInt(String(arr[i]).trim(), 10);
      if (!isNaN(n)) set[n] = true;
    }
    return set;
  }

  function grantedIfBoth(policySet, activeSet, id) {
    return !!(policySet[id] && activeSet[id]);
  }

  function updateGoogleConsentFromOneTrust(pagePolicy) {
		let policySet = toNumberSet(pagePolicy);
		let activeSet = toNumberSet(window.OptanonActiveGroups || window.OnetrustActiveGroups || ',1');
		let functionalGranted  = grantedIfBoth(policySet, activeSet, 3); // category 3
		let adsGranted         = grantedIfBoth(policySet, activeSet, 4); // category 4

		gtag('consent', "default", {"ad_storage":"denied","ad_user_data":"denied","ad_personalization":"denied","personalization_storage":"denied","analytics_storage":"denied","functionality_storage":"denied","security_storage":"denied","wait_for_update":1000});
		gtag('consent', 'update', {
			ad_storage: adsGranted ? 'granted' : 'denied',
			personalization_storage: adsGranted ? 'granted' : 'denied',
			ad_user_data: adsGranted ? 'granted' : 'denied',
			ad_personalization: adsGranted ? 'granted' : 'denied',

			security_storage: functionalGranted ? 'granted' : 'denied',
			analytics_storage:      functionalGranted  ? 'granted' : 'denied',
			functionality_storage:  functionalGranted ? 'granted' : 'denied',
		});
	}


let initOneTrustReady = false;
function OptanonWrapper() {
updateGoogleConsentFromOneTrust(',1,');
	if (!initOneTrustReady) {
		document.dispatchEvent(new CustomEvent('OneTrustLoaded'));
		window.dataLayer.push({'event': 'OneTrustReady'});
		document.dispatchEvent(new CustomEvent('OneTrustReady'));
		// this will error in dev, add ?analytics=1 to url to include analytics and make this fn available
		loadGTM();
		initOneTrustReady = true;
	} else {
		window.dataLayer = window.dataLayer || [];
		window.dataLayer.push({
			'event': 'AnalyticsActiveGroupsUpdated',
			'AnalyticsActiveGroups': window.OptanonActiveGroups || window.OnetrustActiveGroups || ',1'
		});
	}

	if (!Optanon.GetDomainData().ShowAlertNotice || false) {
		afterConsentScripts();
	} else {
		document.querySelector('#onetrust-accept-btn-handler').focus()
	}
	Optanon.OnConsentChanged(function() {
		afterConsentScripts();
	});
}</script><script type="text/javascript">var TS_last_log_date = null;
var TSMakeLogDate = function() {
	var date = new Date();

	var y = date.getFullYear();
	var mo = date.getMonth()+1;
	var d = date.getDate();

	var time = {
	  h: date.getHours(),
	  mi: date.getMinutes(),
	  s: date.getSeconds(),
	  ms: date.getMilliseconds()
	};

	Object.keys(time).map(function(moment, index) {
		if (moment == 'ms') {
			if (time[moment] < 10) {
				time[moment] = time[moment]+'00';
			} else if (time[moment] < 100) {
				time[moment] = time[moment]+'0';
			}
		} else if (time[moment] < 10) {
			time[moment] = '0' + time[moment];
		}
	});

	var str = y + '/' + mo + '/' + d + ' ' + time.h + ':' + time.mi + ':' + time.s + '.' + time.ms;
	if (TS_last_log_date) {
		var diff = date-TS_last_log_date;
		//str+= ' ('+diff+'ms)';
	}
	TS_last_log_date = date;
	return str+' ';
}

var parseDeepLinkRequest = function(code) {
	var m = code.match(/"id":"([CDG][A-Z0-9]{8,})"/);
	var id = m ? m[1] : null;

	m = code.match(/"team":"(T[A-Z0-9]{8,})"/);
	var team = m ? m[1] : null;

	m = code.match(/"message":"([0-9]+\.[0-9]+)"/);
	var message = m ? m[1] : null;

	return { id: id, team: team, message: message };
}

if ('rendererEvalAsync' in window) {
	var origRendererEvalAsync = window.rendererEvalAsync;
	window.rendererEvalAsync = function(blob) {
		try {
			var data = JSON.parse(decodeURIComponent(atob(blob)));
			if (data.code.match(/handleDeepLink/)) {
				var request = parseDeepLinkRequest(data.code);
				if (!request.id || !request.team || !request.message) return;

				request.cmd = 'channel';
				TSSSB.handleDeepLinkWithArgs(JSON.stringify(request));
				return;
			} else {
				origRendererEvalAsync(blob);
			}
		} catch (e) {
		}
	}
}</script><script type="text/javascript">var TSSSB = {
	call: function() {
		return false;
	}
};</script><title>Slack</title><meta name="referrer" content="no-referrer"><meta name="author" content="Slack"><meta name="description" content=""><meta name="keywords" content=""></head><body class="full_height"><div id="page_contents"><div id="props_node" data-props="{&quot;loggedInTeams&quot;:[],&quot;entryPoint&quot;:&quot;&quot;,&quot;teamName&quot;:&quot;TYC&quot;,&quot;teamDomain&quot;:&quot;taiyue&quot;,&quot;encodedTeamId&quot;:&quot;T017G7L7A2H&quot;,&quot;emailJustSent&quot;:false,&quot;shouldRedirect&quot;:true,&quot;redirectURL&quot;:&quot;\/files-pri\/T017G7L7A2H-F0B0K2M7U82\/download\/mapick_v1______________kim_2026-04-29.md&quot;,&quot;redirectQs&quot;:&quot;\/?redir=%2Ffiles-pri%2FT017G7L7A2H-F0B0K2M7U82%2Fdownload%2Fmapick_v1______________kim_2026-04-29.md&quot;,&quot;remember&quot;:false,&quot;hasRemember&quot;:true,&quot;noSSO&quot;:false,&quot;crumbValue&quot;:&quot;s-1777642727-2e0e4e646f517cca69a4166100fc529e3fa7d54c92ea2322064a9419d12182f3-\u2603&quot;,&quot;isSSB&quot;:false,&quot;isSSBSignIn&quot;:false,&quot;isSSBSonicSignIn&quot;:false,&quot;SSBVersion&quot;:&quot;&quot;,&quot;hasEmailError&quot;:false,&quot;emailValue&quot;:&quot;&quot;,&quot;hasPasswordError&quot;:false,&quot;isMobileBrowser&quot;:false,&quot;hasAuthReloginFlow&quot;:false,&quot;hasRateLimit&quot;:false,&quot;recaptchaSitekey&quot;:&quot;6LcRpcIrAAAAAFAe8rv1DygnSMeBZNtDL8rhu2Ze&quot;,&quot;hasSmsRateLimit&quot;:false,&quot;forgotPasswordLink&quot;:&quot;\/forgot&quot;,&quot;showSignupEmailLink&quot;:true,&quot;getStartedLink&quot;:&quot;https:\/\/slack.com\/get-started?entry_point=login#\/find&quot;,&quot;isSSOAuthMode&quot;:false,&quot;isNormalAuthMode&quot;:true,&quot;signinUrl&quot;:&quot;https:\/\/slack.com\/signin&quot;,&quot;signinFindUrl&quot;:&quot;https:\/\/slack.com\/signin\/find&quot;,&quot;ssbRelogin&quot;:&quot;&quot;,&quot;isLoggedOutSSOMaybeRequired&quot;:false,&quot;isLoggedOutRedirect&quot;:true,&quot;teamAuthMode&quot;:null,&quot;authModeGoogle&quot;:&quot;google&quot;,&quot;samlProviderLabel&quot;:null,&quot;errorSource&quot;:&quot;&quot;,&quot;errorMissing&quot;:false,&quot;errorNoUser&quot;:false,&quot;errorDeleted&quot;:false,&quot;errorPassword&quot;:false,&quot;errorSSONoOwner&quot;:false,&quot;errorSSONonRA&quot;:false,&quot;errorTwoFactorWrong&quot;:false,&quot;errorSmsRateLimit&quot;:false,&quot;errorConfirmed&quot;:false,&quot;errorNoPassword&quot;:false,&quot;errorTwoFactorState&quot;:false,&quot;hasEmailOnDomain&quot;:true,&quot;truncatedEmailDomains&quot;:null,&quot;truncatedEmailDomainsCount&quot;:0,&quot;formattedEmailDomains&quot;:&quot;@marcopolo.link&quot;,&quot;isReloginFlow&quot;:false,&quot;downloadLinkSigninCTA&quot;:{&quot;linkUrl&quot;:&quot;\/get-started#\/create?entry_point=login&quot;,&quot;isDownload&quot;:false},&quot;twoFactorRequired&quot;:false,&quot;usingBackup&quot;:null,&quot;twoFactorType&quot;:null,&quot;twoFactorBackupType&quot;:null,&quot;twoFactorRequiredML&quot;:null,&quot;authcodeInputType&quot;:&quot;text&quot;,&quot;backupPhoneNumber&quot;:null,&quot;forgotPasswordError&quot;:&quot;&quot;,&quot;resetLinkSent&quot;:false,&quot;userOauth&quot;:{&quot;apple&quot;:{&quot;enabled&quot;:true,&quot;redirect_url&quot;:&quot;https:\/\/taiyue.slack.com\/workspace-signin\/oauth\/apple\/start?redir=%2Ffiles-pri%2FT017G7L7A2H-F0B0K2M7U82%2Fdownload%2Fmapick_v1______________kim_2026-04-29.md&amp;is_ssb_browser_signin=&quot;},&quot;google&quot;:{&quot;enabled&quot;:true,&quot;redirect_url&quot;:&quot;https:\/\/taiyue.slack.com\/workspace-signin\/oauth\/google\/start?redir=%2Ffiles-pri%2FT017G7L7A2H-F0B0K2M7U82%2Fdownload%2Fmapick_v1______________kim_2026-04-29.md&amp;is_ssb_browser_signin=&quot;}},&quot;isUrgentBannerExpOn&quot;:true,&quot;isWarningBannerExpOn&quot;:true,&quot;signInWithPassword&quot;:false}"></div></div><script type="text/javascript">
/**
 * A placeholder function that the build script uses to
 * replace file paths with their CDN versions.
 *
 * @param {String} file_path - File path
 * @returns {String}
 */
function vvv(file_path) {
		 var vvv_warning = 'You cannot use vvv on dynamic values. Please make sure you only pass in static file paths.'; if (window.TS && window.TS.warn) { window.TS.warn(vvv_warning); } else { console.warn(vvv_warning); } 
	return file_path;
}

var cdn_url = "https:\/\/a.slack-edge.com";
var vvv_abs_url = "https:\/\/slack.com\/";
var inc_js_setup_data = {
	emoji_sheets: {
		apple: 'https://a.slack-edge.com/80588/img/emoji_2017_12_06/sheet_apple_64_indexed_256.png',
		google: 'https://a.slack-edge.com/80588/img/emoji_2017_12_06/sheet_google_64_indexed_256.png',
	},
};
</script><script nonce="" type="text/javascript">	// common boot_data
	var boot_data = {"cdn":{"edges":["https:\/\/a.slack-edge.com\/","https:\/\/b.slack-edge.com\/","https:\/\/a.slack-edge.com\/"],"avatars":"https:\/\/ca.slack-edge.com\/","downloads":"https:\/\/downloads.slack-edge.com\/","files":"https:\/\/slack-files.com\/"},"feature_builder_story_step":false,"feature_olug_remove_required_workspace_setting":false,"feature_file_threads":true,"feature_broadcast_indicator":true,"feature_sonic_emoji":true,"feature_attachments_inline":false,"feature_desktop_symptom_events":false,"feature_gdpr_user_join_tos":true,"feature_user_invite_tos_april_2018":true,"feature_channel_mgmt_message_count":false,"feature_channel_exports":false,"feature_allow_intra_word_formatting":true,"feature_slim_scrollbar":false,"feature_edge_upload_proxy_check":true,"feature_set_tz_automatically":true,"feature_attachments_v2":true,"feature_beacon_js_errors":false,"feature_user_app_disable_speed_bump":true,"feature_apps_manage_permissions_scope_changes":true,"feature_ia_member_profile":true,"feature_desktop_reload_on_generic_error":true,"feature_desktop_extend_app_menu":true,"feature_desktop_restart_service_worker":false,"feature_wta_stop_creation":true,"feature_admin_email_change_confirm":false,"feature_improved_email_rendering":true,"feature_recent_desktop_files":true,"feature_cea_allowlist_changes":false,"feature_cea_channel_management":true,"feature_cea_admin_controls":false,"feature_cea_allowlist_changes_plus":false,"feature_ia_layout":true,"feature_threaded_call_block":true,"feature_enterprise_mobile_device_check":true,"feature_trace_jq_init":true,"feature_seven_days_email_update":true,"feature_channel_sections":true,"feature_show_email_forwarded_by":false,"feature_mpdm_audience_expansion":true,"feature_remove_email_preview_link":true,"feature_desktop_enable_tslog":false,"feature_email_determine_charset":true,"feature_no_deprecation_in_updater":false,"feature_pea_domain_allowlist":true,"feature_composer_auth_admin":true,"experiment_assignments":{"marketing_index_now":{"experiment_id":"10997629882579","type":"visitor","group":"on","schedule_ts":1777355776,"exposure_id":"f41249e078c63398af319de55b68a6bc","trigger":"launch_visitor","log_exposures":false},"gx_signup_security_message":{"experiment_id":"10726565368966","type":"visitor","group":"control","trigger":"finished","log_exposures":false,"exposure_id":"f41249e078c63398af319de55b68a6bc"},"phase_2_slack_teams_compete":{"experiment_id":"10775924967558","type":"visitor","group":"on","schedule_ts":1776870065,"exposure_id":"f41249e078c63398af319de55b68a6bc","trigger":"launch_visitor","log_exposures":false},"team_chat_faq_update_i18n":{"experiment_id":"10927217140004","type":"visitor","group":"on","schedule_ts":1776782071,"exposure_id":"f41249e078c63398af319de55b68a6bc","trigger":"launch_visitor","log_exposures":false},"cust_acq_slackbot_2_hp":{"experiment_id":"10788895416320","type":"visitor","group":"on","schedule_ts":1774979589,"exposure_id":"f41249e078c63398af319de55b68a6bc","trigger":"launch_visitor","log_exposures":false},"social_team_segmentation_visitor_gate":{"experiment_id":"10632194923811","type":"visitor","group":"off","trigger":"finished","log_exposures":false,"exposure_id":"f41249e078c63398af319de55b68a6bc"},"get_started_revamp_existing_users_v2":{"experiment_id":"10680592142133","type":"visitor","group":"treatment","trigger":"finished","log_exposures":false,"exposure_id":"f41249e078c63398af319de55b68a6bc"},"translation_get_started_workspace_aria_labels":{"experiment_id":"10867628810625","type":"visitor","group":"on","trigger":"finished","log_exposures":false,"exposure_id":"f41249e078c63398af319de55b68a6bc"},"nav_unify_slack_vstr":{"experiment_id":"10465017661201","type":"visitor","group":"on","schedule_ts":1776193610,"exposure_id":"f41249e078c63398af319de55b68a6bc","trigger":"launch_visitor","log_exposures":false},"hide_all_webapp_banners":{"experiment_id":"10872013119254","type":"visitor","group":"on","schedule_ts":1776183615,"exposure_id":"f41249e078c63398af319de55b68a6bc","trigger":"launch_visitor","log_exposures":false},"jp_world_tour_hp_banner":{"experiment_id":"10822481748182","type":"visitor","group":"on","schedule_ts":1775833244,"exposure_id":"f41249e078c63398af319de55b68a6bc","trigger":"launch_visitor","log_exposures":false},"activate_browser_deprecation_warning_april_2026":{"experiment_id":"10869856526080","type":"visitor","group":"on","schedule_ts":1775509125,"exposure_id":"f41249e078c63398af319de55b68a6bc","trigger":"launch_visitor","log_exposures":false},"mobile_email_invite_verification":{"experiment_id":"9826078477091","type":"visitor","group":"on","schedule_ts":1770320372,"exposure_id":"f41249e078c63398af319de55b68a6bc","trigger":"launch_visitor","log_exposures":false},"slack_help_center_site_redesign":{"experiment_id":"10143993414212","type":"visitor","group":"on","schedule_ts":1775578665,"exposure_id":"f41249e078c63398af319de55b68a6bc","trigger":"launch_visitor","log_exposures":false},"browser_deprecation_red_banner_april_2026":{"experiment_id":"10315184320450","type":"visitor","group":"on","schedule_ts":1775504851,"exposure_id":"f41249e078c63398af319de55b68a6bc","trigger":"launch_visitor","log_exposures":false},"blog_cta_slack_intent_posts":{"experiment_id":"10763767927414","type":"visitor","group":"treatment","trigger":"hash_visitor","schedule_ts":1775233737,"log_exposures":true,"exposure_id":"f41249e078c63398af319de55b68a6bc"},"blog_cta_template_category":{"experiment_id":"10775631316294","type":"visitor","group":"treatment","trigger":"hash_visitor","schedule_ts":1775233737,"log_exposures":true,"exposure_id":"f41249e078c63398af319de55b68a6bc"},"cust_acq_hp_trust_exp_fr":{"experiment_id":"10766277405554","type":"visitor","group":"treatment","trigger":"hash_visitor","schedule_ts":1775152659,"log_exposures":true,"exposure_id":"f41249e078c63398af319de55b68a6bc"},"cust_acq_customer_mgmt":{"experiment_id":"10691683151460","type":"visitor","group":"on","schedule_ts":1774979590,"exposure_id":"f41249e078c63398af319de55b68a6bc","trigger":"launch_visitor","log_exposures":false},"clearbit2026":{"experiment_id":"10617207267092","type":"visitor","group":"control","trigger":"hash_visitor","schedule_ts":1774887866,"log_exposures":true,"exposure_id":"f41249e078c63398af319de55b68a6bc"},"clearbit2026_loggedin":{"experiment_id":"10742496652964","type":"visitor","group":"control","trigger":"hash_visitor","schedule_ts":1774887865,"log_exposures":true,"exposure_id":"f41249e078c63398af319de55b68a6bc"},"blog_cvr_benchmarking":{"experiment_id":"10539334517286","type":"visitor","group":"control","trigger":"finished","log_exposures":false,"exposure_id":"f41249e078c63398af319de55b68a6bc"},"cust_acq_de_pricing":{"experiment_id":"10594876551236","type":"visitor","group":"treatment","trigger":"finished","log_exposures":false,"exposure_id":"f41249e078c63398af319de55b68a6bc"},"cross_origin_policy_marketplace_controllers":{"experiment_id":"10370110334599","type":"visitor","group":"on","trigger":"hash_visitor","schedule_ts":1769713643,"log_exposures":false,"exposure_id":"f41249e078c63398af319de55b68a6bc"},"mobile_pricing_logos_messaging":{"experiment_id":"10711954997332","type":"visitor","group":"treatment","trigger":"hash_visitor","schedule_ts":1773931775,"log_exposures":true,"exposure_id":"f41249e078c63398af319de55b68a6bc"},"resources_cvr_benchmarking":{"experiment_id":"10749687846656","type":"visitor","group":"control","trigger":"hash_visitor","schedule_ts":1773845085,"log_exposures":true,"exposure_id":"f41249e078c63398af319de55b68a6bc"},"activate_browser_deprecation_warning_march_2026":{"experiment_id":"10699599084948","type":"visitor","group":"on","schedule_ts":1773688562,"exposure_id":"f41249e078c63398af319de55b68a6bc","trigger":"launch_visitor","log_exposures":false},"ios_mobile_team_creation_revamp_v_1":{"experiment_id":"8923214535731","type":"visitor","group":"on","trigger":"finished","log_exposures":false,"exposure_id":"f41249e078c63398af319de55b68a6bc"},"tl_slack_vs_teams":{"experiment_id":"10341080467637","type":"visitor","group":"on","schedule_ts":1772065039,"exposure_id":"f41249e078c63398af319de55b68a6bc","trigger":"launch_visitor","log_exposures":false},"cust_acq_signed_in_hp_revamped":{"experiment_id":"10051199476325","type":"visitor","group":"treatment","trigger":"finished","log_exposures":false,"exposure_id":"f41249e078c63398af319de55b68a6bc"},"hp_revamp_25_exp":{"experiment_id":"10173190914803","type":"visitor","group":"treatment","schedule_ts":1766512091,"exposure_id":"f41249e078c63398af319de55b68a6bc","trigger":"launch_visitor","log_exposures":false},"admin_email_verification_v1_translations":{"experiment_id":"9848465692741","type":"visitor","group":"on","schedule_ts":1770129550,"exposure_id":"f41249e078c63398af319de55b68a6bc","trigger":"launch_visitor","log_exposures":false},"mobile_web_optimizations":{"experiment_id":"10028552136000","type":"visitor","group":"treatment","trigger":"finished","log_exposures":false,"exposure_id":"f41249e078c63398af319de55b68a6bc"},"mobile_web_optimizations_row":{"experiment_id":"10003559639028","type":"visitor","group":"treatment","trigger":"finished","log_exposures":false,"exposure_id":"f41249e078c63398af319de55b68a6bc"},"cust_acq_get_started_free_copy":{"experiment_id":"10501310080289","type":"visitor","group":"control","trigger":"hash_visitor","schedule_ts":1770902107,"log_exposures":true,"exposure_id":"f41249e078c63398af319de55b68a6bc"},"activate_browser_deprecation_warning_february_2026":{"experiment_id":"10443474327988","type":"visitor","group":"on","schedule_ts":1770304755,"exposure_id":"f41249e078c63398af319de55b68a6bc","trigger":"launch_visitor","log_exposures":false},"cust_acq_roi":{"experiment_id":"10111064219827","type":"visitor","group":"on","schedule_ts":1770242336,"exposure_id":"f41249e078c63398af319de55b68a6bc","trigger":"launch_visitor","log_exposures":false},"cust_acq_january_feature_drop":{"experiment_id":"10377412751717","type":"visitor","group":"on","schedule_ts":1770056354,"exposure_id":"f41249e078c63398af319de55b68a6bc","trigger":"launch_visitor","log_exposures":false},"workflow_builder":{"experiment_id":"9193723819463","type":"visitor","group":"on","trigger":"finished","log_exposures":false,"exposure_id":"f41249e078c63398af319de55b68a6bc"},"cust_acq_whats_new":{"experiment_id":"9944278749911","type":"visitor","group":"on","schedule_ts":1766434685,"exposure_id":"f41249e078c63398af319de55b68a6bc","trigger":"launch_visitor","log_exposures":false},"email_optin_for_invite_join":{"experiment_id":"10239697974452","type":"visitor","group":"on","schedule_ts":1768414705,"exposure_id":"f41249e078c63398af319de55b68a6bc","trigger":"launch_visitor","log_exposures":false},"email_tips_pref_set_during_sso":{"experiment_id":"10060663792534","type":"visitor","group":"on","schedule_ts":1767897725,"exposure_id":"f41249e078c63398af319de55b68a6bc","trigger":"launch_visitor","log_exposures":false},"cust_acq_plans_banner_sparkles":{"experiment_id":"10279027415110","type":"visitor","group":"on","schedule_ts":1768318749,"exposure_id":"f41249e078c63398af319de55b68a6bc","trigger":"launch_visitor","log_exposures":false},"teams_compete":{"experiment_id":"10025794984901","type":"visitor","group":"on","schedule_ts":1766095647,"exposure_id":"f41249e078c63398af319de55b68a6bc","trigger":"launch_visitor","log_exposures":false},"get_started_opt_intl_new_user":{"experiment_id":"9776741088502","type":"visitor","group":"treatment_with_modal","trigger":"finished","log_exposures":false,"exposure_id":"f41249e078c63398af319de55b68a6bc"},"get_started_opt_intl_existing_user":{"experiment_id":"9806784292240","type":"visitor","group":"control","trigger":"finished","log_exposures":false,"exposure_id":"f41249e078c63398af319de55b68a6bc"},"app_directory_connectors":{"experiment_id":"6144504493874","type":"visitor","group":"treatment","schedule_ts":1705354312,"exposure_id":"f41249e078c63398af319de55b68a6bc","trigger":"launch_visitor","log_exposures":false},"app_directory_connectors_collection":{"experiment_id":"6321714753558","type":"visitor","group":"on","schedule_ts":1705448247,"exposure_id":"f41249e078c63398af319de55b68a6bc","trigger":"launch_visitor","log_exposures":false},"mrbeast_campaign":{"experiment_id":"9803944014723","type":"visitor","group":"on","schedule_ts":1762545488,"exposure_id":"f41249e078c63398af319de55b68a6bc","trigger":"launch_visitor","log_exposures":false},"hp_dreamforce_2025":{"experiment_id":"9631955160816","type":"visitor","group":"on","schedule_ts":1760356527,"exposure_id":"f41249e078c63398af319de55b68a6bc","trigger":"launch_visitor","log_exposures":false},"newxp_12562_coop_header_fix":{"experiment_id":"9658010997669","type":"visitor","group":"on","schedule_ts":1759965573,"exposure_id":"f41249e078c63398af319de55b68a6bc","trigger":"launch_visitor","log_exposures":false},"revamp_translation":{"experiment_id":"9715852724503","type":"visitor","group":"on","schedule_ts":1761590850,"exposure_id":"f41249e078c63398af319de55b68a6bc","trigger":"launch_visitor","log_exposures":false},"make_captcha_mandatory":{"experiment_id":"9152757690695","type":"visitor","group":"on","schedule_ts":1756492106,"exposure_id":"f41249e078c63398af319de55b68a6bc","trigger":"launch_visitor","log_exposures":false},"slack_trials_tof":{"experiment_id":"9687474940791","type":"visitor","group":"aa_treatment","trigger":"hash_visitor","schedule_ts":1760545417,"log_exposures":true,"exposure_id":"f41249e078c63398af319de55b68a6bc"},"aswebauth_cookie_session":{"experiment_id":"7920012625699","type":"visitor","group":"on","trigger":"finished","log_exposures":false,"exposure_id":"f41249e078c63398af319de55b68a6bc"},"enterprise_search_demo":{"experiment_id":"8892730774644","type":"visitor","group":"on","trigger":"finished","log_exposures":false,"exposure_id":"f41249e078c63398af319de55b68a6bc"},"recaptcha_enterprise_migration":{"experiment_id":"9412496834887","type":"visitor","group":"on","schedule_ts":1758834250,"exposure_id":"f41249e078c63398af319de55b68a6bc","trigger":"launch_visitor","log_exposures":false},"stripe_us_address":{"experiment_id":"9575757500321","type":"visitor","group":"on","schedule_ts":1759256395,"exposure_id":"f41249e078c63398af319de55b68a6bc","trigger":"launch_visitor","log_exposures":false},"marketing_optin_via_geo_library":{"experiment_id":"9500088909685","type":"visitor","group":"on","schedule_ts":1758125993,"exposure_id":"f41249e078c63398af319de55b68a6bc","trigger":"launch_visitor","log_exposures":false},"optimize_get_started_flow":{"experiment_id":"9119755158055","type":"visitor","group":"treatment","schedule_ts":1757009002,"exposure_id":"f41249e078c63398af319de55b68a6bc","trigger":"launch_visitor","log_exposures":false},"agent_dotcom_help":{"experiment_id":"8150736357476","type":"visitor","group":"on","schedule_ts":1757725719,"exposure_id":"f41249e078c63398af319de55b68a6bc","trigger":"launch_visitor","log_exposures":false},"partners_contact":{"experiment_id":"9508808187494","type":"visitor","group":"on","schedule_ts":1757716577,"exposure_id":"f41249e078c63398af319de55b68a6bc","trigger":"launch_visitor","log_exposures":false},"email_optin_via_geo_library":{"experiment_id":"9482988226449","type":"visitor","group":"on","schedule_ts":1757370053,"exposure_id":"f41249e078c63398af319de55b68a6bc","trigger":"launch_visitor","log_exposures":false},"integrations_update":{"experiment_id":"9304450356548","type":"visitor","group":"on","schedule_ts":1755802338,"exposure_id":"f41249e078c63398af319de55b68a6bc","trigger":"launch_visitor","log_exposures":false},"marketing_hc_agent_send_ga":{"experiment_id":"9368939411444","type":"visitor","group":"on","schedule_ts":1756933151,"exposure_id":"f41249e078c63398af319de55b68a6bc","trigger":"launch_visitor","log_exposures":false},"sticky_ctas":{"experiment_id":"9347505043607","type":"visitor","group":"on","schedule_ts":1755638126,"exposure_id":"f41249e078c63398af319de55b68a6bc","trigger":"launch_visitor","log_exposures":false},"versionify_url_for_invites":{"experiment_id":"9239948574183","type":"visitor","group":"on","schedule_ts":1753809230,"exposure_id":"f41249e078c63398af319de55b68a6bc","trigger":"launch_visitor","log_exposures":false},"marketing_templates_hreflang":{"experiment_id":"9344139344375","type":"visitor","group":"on","schedule_ts":1755280514,"exposure_id":"f41249e078c63398af319de55b68a6bc","trigger":"launch_visitor","log_exposures":false},"pricing_post_pnp_style_updates":{"experiment_id":"9269054427686","type":"visitor","group":"on","schedule_ts":1754594057,"exposure_id":"f41249e078c63398af319de55b68a6bc","trigger":"launch_visitor","log_exposures":false},"phone_number_de":{"experiment_id":"7168806134229","type":"visitor","group":"treatment","schedule_ts":1716908444,"exposure_id":"f41249e078c63398af319de55b68a6bc","trigger":"launch_visitor","log_exposures":false},"phone_number_fr":{"experiment_id":"7157169096183","type":"visitor","group":"treatment","schedule_ts":1716912646,"exposure_id":"f41249e078c63398af319de55b68a6bc","trigger":"launch_visitor","log_exposures":false},"phone_number_au":{"experiment_id":"7168837725445","type":"visitor","group":"treatment","schedule_ts":1716912663,"exposure_id":"f41249e078c63398af319de55b68a6bc","trigger":"launch_visitor","log_exposures":false},"phone_number_br":{"experiment_id":"7256414077620","type":"visitor","group":"treatment","schedule_ts":1719244830,"exposure_id":"f41249e078c63398af319de55b68a6bc","trigger":"launch_visitor","log_exposures":false},"phone_number_it":{"experiment_id":"7250980705925","type":"visitor","group":"treatment","schedule_ts":1719253456,"exposure_id":"f41249e078c63398af319de55b68a6bc","trigger":"launch_visitor","log_exposures":false},"phone_number_es":{"experiment_id":"7266548128369","type":"visitor","group":"treatment","schedule_ts":1719253482,"exposure_id":"f41249e078c63398af319de55b68a6bc","trigger":"launch_visitor","log_exposures":false},"phone_number_ca":{"experiment_id":"7256320861108","type":"visitor","group":"treatment","schedule_ts":1718813429,"exposure_id":"f41249e078c63398af319de55b68a6bc","trigger":"launch_visitor","log_exposures":false},"marketing_pricing_page_meta":{"experiment_id":"9253895333078","type":"visitor","group":"on","schedule_ts":1753723294,"exposure_id":"f41249e078c63398af319de55b68a6bc","trigger":"launch_visitor","log_exposures":false},"phone_number_pt":{"experiment_id":"7276731000896","type":"visitor","group":"treatment","schedule_ts":1719253468,"exposure_id":"f41249e078c63398af319de55b68a6bc","trigger":"launch_visitor","log_exposures":false},"phone_number_ko":{"experiment_id":"7276620382240","type":"visitor","group":"treatment","schedule_ts":1719852648,"exposure_id":"f41249e078c63398af319de55b68a6bc","trigger":"launch_visitor","log_exposures":false},"phone_number_ie":{"experiment_id":"7441623906036","type":"visitor","group":"treatment","schedule_ts":1721414251,"exposure_id":"f41249e078c63398af319de55b68a6bc","trigger":"launch_visitor","log_exposures":false},"phone_number_jp":{"experiment_id":"7174178940996","type":"visitor","group":"treatment","schedule_ts":1716583378,"exposure_id":"f41249e078c63398af319de55b68a6bc","trigger":"launch_visitor","log_exposures":false},"agent_demo_contact":{"experiment_id":"9180003200743","type":"visitor","group":"on","schedule_ts":1753365260,"exposure_id":"f41249e078c63398af319de55b68a6bc","trigger":"launch_visitor","log_exposures":false},"partner_promos_pnp":{"experiment_id":"8997210765159","type":"visitor","group":"on","schedule_ts":1750106249,"exposure_id":"f41249e078c63398af319de55b68a6bc","trigger":"launch_visitor","log_exposures":false},"dreamforce_promo":{"experiment_id":"9163466061797","type":"visitor","group":"on","schedule_ts":1752590157,"exposure_id":"f41249e078c63398af319de55b68a6bc","trigger":"launch_visitor","log_exposures":false},"july1_launch":{"experiment_id":"9111164109201","type":"visitor","group":"on","schedule_ts":1751403911,"exposure_id":"f41249e078c63398af319de55b68a6bc","trigger":"launch_visitor","log_exposures":false},"miro_marketplace":{"experiment_id":"8704952792931","type":"visitor","group":"on","schedule_ts":1750982806,"exposure_id":"f41249e078c63398af319de55b68a6bc","trigger":"launch_visitor","log_exposures":false},"channels_update":{"experiment_id":"8954244938662","type":"visitor","group":"on","schedule_ts":1748951415,"exposure_id":"f41249e078c63398af319de55b68a6bc","trigger":"launch_visitor","log_exposures":false},"spam_email_recaptcha_v3":{"experiment_id":"8890538137939","type":"visitor","group":"on","schedule_ts":1749589661,"exposure_id":"f41249e078c63398af319de55b68a6bc","trigger":"launch_visitor","log_exposures":false},"marketing_aff":{"experiment_id":"5743479690565","type":"visitor","group":"on","schedule_ts":1749577342,"exposure_id":"f41249e078c63398af319de55b68a6bc","trigger":"launch_visitor","log_exposures":false},"signin_design_refresh":{"experiment_id":"8656625636818","type":"visitor","group":"on","schedule_ts":1746462640,"exposure_id":"f41249e078c63398af319de55b68a6bc","trigger":"launch_visitor","log_exposures":false},"creator_landing_view_refactor":{"experiment_id":"8986548312550","type":"visitor","group":"on","schedule_ts":1749141715,"exposure_id":"f41249e078c63398af319de55b68a6bc","trigger":"launch_visitor","log_exposures":false},"innovations_lp":{"experiment_id":"8253871971107","type":"visitor","group":"on","schedule_ts":1746643793,"exposure_id":"f41249e078c63398af319de55b68a6bc","trigger":"launch_visitor","log_exposures":false},"enterprise_search_lp":{"experiment_id":"8787098737047","type":"visitor","group":"on","schedule_ts":1746641312,"exposure_id":"f41249e078c63398af319de55b68a6bc","trigger":"launch_visitor","log_exposures":false},"mris_extension":{"experiment_id":"4746206947365","type":"visitor","group":"on","schedule_ts":1706216371,"exposure_id":"f41249e078c63398af319de55b68a6bc","trigger":"launch_visitor","log_exposures":false},"on24_extension":{"experiment_id":"4772019824211","type":"visitor","group":"on","schedule_ts":1675891595,"exposure_id":"f41249e078c63398af319de55b68a6bc","trigger":"launch_visitor","log_exposures":false},"downloads_launch":{"experiment_id":"8552687986532","type":"visitor","group":"on","schedule_ts":1741711036,"exposure_id":"f41249e078c63398af319de55b68a6bc","trigger":"launch_visitor","log_exposures":false},"activation_enterprise_signin_primer":{"experiment_id":"6443324713893","type":"visitor","group":"on","trigger":"finished","log_exposures":false,"exposure_id":"f41249e078c63398af319de55b68a6bc"},"screen_text_2fa":{"experiment_id":"7846147603012","type":"visitor","group":"on","schedule_ts":1734375504,"exposure_id":"f41249e078c63398af319de55b68a6bc","trigger":"launch_visitor","log_exposures":false},"app_directory_coral":{"experiment_id":"8121125935588","type":"visitor","group":"on","trigger":"finished","log_exposures":false,"exposure_id":"f41249e078c63398af319de55b68a6bc"},"marketplace_add":{"experiment_id":"7940445156581","type":"visitor","group":"on","schedule_ts":1732060351,"exposure_id":"f41249e078c63398af319de55b68a6bc","trigger":"launch_visitor","log_exposures":false},"marketing_ad_app_store_urls":{"experiment_id":"7746105288676","type":"visitor","group":"on","schedule_ts":1726699830,"exposure_id":"f41249e078c63398af319de55b68a6bc","trigger":"launch_visitor","log_exposures":false},"search_zd_vs_solr":{"experiment_id":"1355709002145","type":"visitor","group":"control","trigger":"finished","log_exposures":false,"exposure_id":"f41249e078c63398af319de55b68a6bc"},"apidocs_ad_unit_enable":{"experiment_id":"6141172005908","type":"visitor","group":"on","trigger":"hash_visitor","schedule_ts":1712177688,"log_exposures":false,"exposure_id":"f41249e078c63398af319de55b68a6bc"},"downloads_s2p_promo":{"experiment_id":"7132023966439","type":"visitor","group":"treatment","trigger":"hash_visitor","schedule_ts":1718307458,"log_exposures":true,"exposure_id":"f41249e078c63398af319de55b68a6bc"},"paid_lp_expand":{"experiment_id":"7134287733637","type":"visitor","group":"treatment","schedule_ts":1717713269,"exposure_id":"f41249e078c63398af319de55b68a6bc","trigger":"launch_visitor","log_exposures":false},"marketing_live_chat_emea":{"experiment_id":"7226533858036","type":"visitor","group":"on","schedule_ts":1717629445,"exposure_id":"f41249e078c63398af319de55b68a6bc","trigger":"launch_visitor","log_exposures":false},"new_paid_lp":{"experiment_id":"6818768684695","type":"visitor","group":"treatment","trigger":"finished","log_exposures":false,"exposure_id":"f41249e078c63398af319de55b68a6bc"},"slack_elevate_launch":{"experiment_id":"6966627699558","type":"visitor","group":"on","schedule_ts":1713959798,"exposure_id":"f41249e078c63398af319de55b68a6bc","trigger":"launch_visitor","log_exposures":false},"marketing_recaptcha_hc":{"experiment_id":"6963734115829","type":"visitor","group":"on","schedule_ts":1713301140,"exposure_id":"f41249e078c63398af319de55b68a6bc","trigger":"launch_visitor","log_exposures":false},"marketing_hc_flow_specifier":{"experiment_id":"6989238991504","type":"visitor","group":"on","schedule_ts":1713296815,"exposure_id":"f41249e078c63398af319de55b68a6bc","trigger":"launch_visitor","log_exposures":false},"anthony_test_visitor_1":{"experiment_id":"6823470010164","type":"visitor","group":"treatment","schedule_ts":1712613615,"exposure_id":"f41249e078c63398af319de55b68a6bc","trigger":"launch_visitor","log_exposures":false},"marketing_media_kit":{"experiment_id":"6696687337684","type":"visitor","group":"on","schedule_ts":1709232747,"exposure_id":"f41249e078c63398af319de55b68a6bc","trigger":"launch_visitor","log_exposures":false},"out_of_office_xmas_jp":{"experiment_id":"6296845198293","type":"visitor","group":"off","trigger":"finished","log_exposures":false,"exposure_id":"f41249e078c63398af319de55b68a6bc"},"out_of_office_xmas":{"experiment_id":"6322553087328","type":"visitor","group":"off","trigger":"finished","log_exposures":false,"exposure_id":"f41249e078c63398af319de55b68a6bc"},"marketing_hreflang_errors_fix":{"experiment_id":"6319747700807","type":"visitor","group":"on","schedule_ts":1702931766,"exposure_id":"f41249e078c63398af319de55b68a6bc","trigger":"launch_visitor","log_exposures":false},"new_gated_demo":{"experiment_id":"6171698537921","type":"visitor","group":"on","schedule_ts":1701209093,"exposure_id":"f41249e078c63398af319de55b68a6bc","trigger":"launch_visitor","log_exposures":false},"marketing_cj":{"experiment_id":"5820701519667","type":"visitor","group":"on","schedule_ts":1699033035,"exposure_id":"f41249e078c63398af319de55b68a6bc","trigger":"launch_visitor","log_exposures":false},"deny_russian_ip":{"experiment_id":"3201051153989","type":"visitor","group":"on","trigger":"finished","log_exposures":false,"exposure_id":"f41249e078c63398af319de55b68a6bc"},"swap_ukraine_logo_toggle":{"experiment_id":"5598910456034","type":"visitor","group":"on","schedule_ts":1689885040,"exposure_id":"f41249e078c63398af319de55b68a6bc","trigger":"launch_visitor","log_exposures":false},"slack_ie_address":{"experiment_id":"4857849748754","type":"visitor","group":"on","schedule_ts":1677793396,"exposure_id":"f41249e078c63398af319de55b68a6bc","trigger":"launch_visitor","log_exposures":false},"proj_brand_customer_stories_lp":{"experiment_id":"3448021380448","type":"visitor","group":"on","schedule_ts":1653596127,"exposure_id":"f41249e078c63398af319de55b68a6bc","trigger":"launch_visitor","log_exposures":false},"digital_first_lightning_strike_custacq":{"experiment_id":"2220660679364","type":"visitor","group":"on","schedule_ts":1625075563,"exposure_id":"f41249e078c63398af319de55b68a6bc","trigger":"launch_visitor","log_exposures":false}},"no_login":false};</script><link href="https://a.slack-edge.com/bv1-13/login-core.ad3863b26bfabd4f6da3.primer.min.css" rel="stylesheet" type="text/css" onload="window._cdn ? _cdn.ok(this, arguments) : null" onerror="window._cdn ? _cdn.failed(this, arguments) : null" crossorigin="anonymous"><link href="https://a.slack-edge.com/bv1-13/rollup-style-slack-kit-base.a68a93c7c25b248fb058.min.css" rel="stylesheet" id="slack_kit_helpers" type="text/css" onload="window._cdn ? _cdn.ok(this, arguments) : null" onerror="window._cdn ? _cdn.failed(this, arguments) : null" crossorigin="anonymous"><link href="https://a.slack-edge.com/bv1-13/rollup-style-slack-kit-helpers.75458f7b31687d59b0a9.min.css" rel="stylesheet" id="slack_kit_helpers" type="text/css" onload="window._cdn ? _cdn.ok(this, arguments) : null" onerror="window._cdn ? _cdn.failed(this, arguments) : null" crossorigin="anonymous"><script>if (window._cdn) _cdn.scanPageAssets();</script>

<!-- slack-www-hhvm-main-iad-gyvys2dvkmf2/ 2026-05-01 06:38:47/ v90a3ed4b9d9ce5794c493d9d0e5588e6733bdd5a/ B:H -->

</body></html>