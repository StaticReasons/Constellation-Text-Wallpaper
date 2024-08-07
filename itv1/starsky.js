"use strict";

var winW = 0, winH = 0, vmax, vmin, winStable = true;
var ctx, canvasEle;
const picW = 5754, picH = 3840;
var picScale;
const PI = 3.14159265358979;

var cX2P = 0.5, cY2P = 0.56, cX, cY;
//var cX2P = 0.5, cY2P = 0.5, cX, cY;
var r2vDiag = 0.6, r, omega = 2 * Math.PI / 400000, theta = 0, timeBase = new Date() - 0;
var starCnt = 20000, stars = [];
//theta = omega * (t - timeBase), 过2Math.PI不重置

var pressStart, fadeFrom, fadeTo, fadeParam;
var frameW2vmin = 0.011, frameDist2vmin = 0.016;

var flagX2W = 0.5, flagY2W = 0.3;
var flagW2W = 0.9, flagH2W = 0.6;
//var flagW2W = 0.5, flagH2W = 0.3;
var flagW, flagH, flagX, flagY;
var flags = [], flagNowAt = -2, flagNow;

var pickQueue = [], pickInt = [0, 0]

/*
	pickQueue = [[t1, frame],...]
*/
/*
	flag 结构:
	flag = {
			rawDim : [w, h], 	//原始尺寸
			realDim : [x, y, ratio]	//坐标和实际缩放比
			rawDOM : xxx,	//svgDOM
			lines : [		//线段
				{
					ends: [x1, y1, x2, y2],	//端点坐标
					//阶段1计算量
					//节框是将一段线段的筛选框沿线段分成若干节，每个节框仅选取一星，作为星段的一部分
					//特别的，两个端点处分别再独立分割出一个以端点为中心的正方形节框；
					dim: [l, w],	//长宽
					frames:[
						{
							ends: [x1, y1, x2, y2],	//端点坐标
							dim: [l, w],	//长宽
							intOfStars : [		//记录所有可能进入每个节框的星
								{
									starIndex : i,	//星在星数组的索引
									interval : [],	//入框区间集
									nextIntEndI : i	//实时计算量，theta的右邻区间端点，无论左或右端点
								},...
							],
							starPicked : i			//阶段2计算量
						}
					]
				},...
			]
	}
*/

/*
	star 结构:
	star = {
		r : r0,
		theta : theta0, 	//初始坐标
		color : [r, g, b],
		size : r,
		alpha : [b, A, w, phi],	//wave func: b * (1 - A/2 + (A/2)cos(w*theta + phi))
		evalX : 1	//
		evalY : 1	//
	}
*/

function zhi(s) {
	document.getElementById('testp').innerText = s;
}

function lerp(x, y, t) { return x * (1 - t) + y * t; }

function lerp3(x, y, z, t) { return t < 0 ? lerp(x, y, 1 + t) : lerp(y, z, t) }

function clamp(a, b, x) { return Math.min(Math.max(x, a), b) }

//入框区间集，记录每个区间的边界，边界点两两配对，末尾未配对的延伸至正无穷，
//[0]位是flag，指示第一区间是否向左延伸至负无穷
function intervalCalc(x, y, logic = (x0, y0) => x0 && y0 && true) {
	let x_ = x.concat(), y_ = y.concat();
	let src = [x_, y_, [!logic(!x_[0], !y_[0]) - 0]];
	if (src.findIndex(a => a.length == 0) + 1) throw "Null Interval";
	src.forEach(a => a[0] = !!a[0] - 0);
	let p = [0, 0, 0];
	let end = [false, false];
	let c, j;	//j : channel chooser
	while (true) {
		//End detect
		end = [
			end[0] || src[0].length == p[0] + 1,
			end[1] || src[1].length == p[1] + 1
		];
		//Terminate
		if (end[0] && end[1]) break;
		//Step
		p[(end[0] || !end[1] &&
			src[0][p[0] + 1] > src[1][p[1] + 1]
		) - 0]++;
		//Comp
		j = (!p[0] || p[1] && src[0][p[0]] < src[1][p[1]]) - 0;
		//Calc
		c = logic(
			(p[0] + src[0][0] + 1) % 2,
			(p[1] + src[1][0] + 1) % 2
		) - 0;
		if ((p[2] + src[2][0] + 1) % 2 != c) {
			src[2].push(src[j][p[j]]);
			p[2]++;
		}
		//console.log(JSON.stringify(src), JSON.stringify(p), JSON.stringify(end), c, j)
	}
	return src[2];
}

function intervalFold(x, t) {
	let y = x.concat();
	if (y.length == 0) throw "Null Interval";
	if (t == 0) throw "period length = 0 ?!"
	y[0] = !!y[0] - 0;
	if (y.length == 1) return y;
	let k = Math.floor(y[1] / t);
	let p = 1;
	let res = [1];
	while (true) {
		while (p < y.length && y[p] <= (k + 1) * t) p++;
		res = intervalCalc(
			y.splice(0, p, !((p - y[0]) % 2) - 0)
				.map((x, i) => i == 0 ? x : x - k * t),
			res, (x, y) => !!(x || y)
		);
		if ((p = 1) == y.length) break;
		k++;
	}
	return res;
}

//Loading
async function svgLoad() {
	let cnt = 1;
	while (cnt > 0) {
		await fetch("./flag" + cnt + ".svg")
			.then(response => response.text())
			.then(text => (new DOMParser()).parseFromString(text, "image/svg+xml"))
			.then(svgDOM => {
				let w = svgDOM.querySelector("svg").getAttribute("width");
				let h = svgDOM.querySelector("svg").getAttribute("height");
				if (!(w && h)) throw 0;
				let flag = {
					rawDim: [w, h],
					realDim: [0, 0, 0],
					rawDOM: svgDOM,
					lines: []
				};
				flags.push(flag);
				cnt++;
			})
			.catch(rej => { cnt = 0; });
	}
	flagNowAt = flags.length > 0 ? 0 : -1;
	flagNow = flags[flagNowAt];
}

function updateWinDims() {
	let winW0 = window.innerWidth
		|| document.documentElement.clientWidth
		|| document.body.clientWidth;

	let winH0 = window.innerHeight
		|| document.documentElement.clientHeight
		|| document.body.clientHeight;

	let unchanged = winW == winW0 && winH == winH0;
	winW = winW0;
	winH = winH0;
	vmax = Math.max(winW, winH);
	vmin = Math.max(winW, winH);
	return unchanged;
}

async function starInit() {
	stars = Array(starCnt).fill(0).map((x, i) => 0 || {
		r: Math.sqrt(Math.random()) * r2vDiag * Math.sqrt(winH ** 2 + winW ** 2),
		theta: Math.random() * 2 * Math.PI,
		color: (t => [
			Math.floor(lerp3(0x90, 0xf0, 0xf0, t)),
			Math.floor(lerp3(0xb0, 0xf0, 0x80, t)),
			Math.floor(lerp3(0xf0, 0xf0, 0x80, t))
		])((Math.random() * 2 - 1) ** 5),
		size: lerp(0.0002, 0.0006, Math.sqrt(Math.random())) * vmax,
		alpha: [
			lerp(0.5, 1., Math.random()),	//b
			lerp(0.1, 0.75, Math.random() ** 0.5),	//A
			lerp(100, 400, Math.random()),	//w
			lerp(0, 2 * Math.PI, Math.random()),	//phi
		]
	}).sort((l, r) => l.r - r.r);
}

function updateCoord() {
	let picX = 0, picY = 0;
	if (winW / winH > picW / picH) {
		picScale = winW / picW;
		picY = -(picScale * picH - winH) / 2;
	} else {
		picScale = winH / picH;
		picX = -(picScale * picW - winW) / 2;
	}
	cX = picW * picScale * cX2P + picX;
	cY = picH * picScale * cY2P + picY;

	if (flagNowAt == -1) return;
	flags.forEach((x, i) => {
		if (flagW2W / flagH2W * winW / winH < x.rawDim[0] / x.rawDim[1]) x.realDim[2] = flagW2W * winW / x.rawDim[0];
		else x.realDim[2] = flagH2W * winH / x.rawDim[1];
		x.realDim[0] = flagX2W * winW;
		x.realDim[1] = flagY2W * winH;
	});
	flagX = flagNow.realDim[0];
	flagY = flagNow.realDim[1];
	flagW = flagNow.realDim[2] * flagNow.rawDim[0];
	flagH = flagNow.realDim[2] * flagNow.rawDim[1];
}

async function frameInit() {
	canvasEle = window.document.getElementById("canvas");
	if (canvasEle.getContext) {
		ctx = canvasEle.getContext("2d");
	}
	else {
		console.log("ctx not found");
		return 0;
	}
	flags.forEach((flag, i) => {
		flag.rawDOM.querySelectorAll("line").forEach((lineEle, j) => {
			//初始化 和端点坐标
			let line = {
				ends: [
					(lineEle.getAttribute("x1") - flag.rawDim[0] / 2) * flag.realDim[2] + flag.realDim[0],
					(lineEle.getAttribute("y1") - flag.rawDim[1] / 2) * flag.realDim[2] + flag.realDim[1],
					(lineEle.getAttribute("x2") - flag.rawDim[0] / 2) * flag.realDim[2] + flag.realDim[0],
					(lineEle.getAttribute("y2") - flag.rawDim[1] / 2) * flag.realDim[2] + flag.realDim[1],
				],
				dim: [0, 0],
				frames: []
			}
			//下向化，确保第二点y坐标大于第一点
			if (line.ends[1] > line.ends[3]) {
				let tmp = line.ends[1];
				line.ends[1] = line.ends[3];
				line.ends[3] = tmp;
				tmp = line.ends[0];
				line.ends[0] = line.ends[2];
				line.ends[2] = tmp;
			}
			line.dim[0] =
				Math.sqrt((line.ends[2] - line.ends[0]) ** 2 + (line.ends[3] - line.ends[1]) ** 2);
			line.dim[1] = frameW2vmin * vmin;

			ctx.strokeStyle = `rgba(255,255,255,.3)`;
			ctx.lineWidth = 8;
			ctx.beginPath();
			ctx.moveTo(line.ends[0], line.ends[1]);
			ctx.lineTo(line.ends[2], line.ends[3]);
			ctx.stroke();

			line.frames = Array(
				Math.max(Math.floor(
					(line.dim[0] - line.dim[1]) / (frameDist2vmin * vmin)
				), 2)
			).fill(0)
				.map((frame, k, frames) => {
					frame = {
						ends: [0, 0, 0, 0],
						dim: [line.dim[1], line.dim[1]],
						intOfStars: [],
						starPicked: -1
					}
					//在ends的[1]位和[3]位中先存放节框首尾的线性插值系数，line从头到尾（两端各延长半个宽度）上插值
					frame.ends[1] = lerp(
						-line.dim[1] / 2 / line.dim[0],
						1 + line.dim[1] / 2 / line.dim[0],
						k / frames.length
					);
					frame.ends[3] = lerp(
						-line.dim[1] / 2 / line.dim[0],
						1 + line.dim[1] / 2 / line.dim[0],
						(k + 1) / frames.length
					);
					frame.dim[0] = (line.dim[0] + line.dim[1]) / frames.length;
					//插值
					frame.ends[0] = lerp(line.ends[0], line.ends[2], frame.ends[1]);
					frame.ends[1] = lerp(line.ends[1], line.ends[3], frame.ends[1]);
					frame.ends[2] = lerp(line.ends[0], line.ends[2], frame.ends[3]);
					frame.ends[3] = lerp(line.ends[1], line.ends[3], frame.ends[3]);

					ctx.strokeStyle = k % 2 == 0 ? `rgba(255,100,255,1)` : `rgba(100,255,255,1)`;
					ctx.lineWidth = 1;
					ctx.beginPath();
					ctx.moveTo(frame.ends[0], frame.ends[1]);
					ctx.lineTo(frame.ends[2], frame.ends[3]);
					ctx.stroke();

					return frame;
				});

			flag.lines.push(line);
		});
	});
}

async function starEncounterCalc() {
	if (canvasEle.getContext) {
		ctx = canvasEle.getContext("2d");
	}
	else {
		console.log("ctx not found");
		return 0;
	}
	ctx.clearRect(0, 0, winW, winH);
	ctx.fillStyle = `rgba(255,255,255,1)`;
	ctx.beginPath();
	ctx.moveTo(cX, cY);
	ctx.arc(cX, cY, 2, 0, 2 * Math.PI);
	ctx.fill();

	flags.forEach((flag, flagi) => {
		flag.lines.forEach((line, linei) => {
			line.frames.forEach((f, framei) => {

				ctx.clearRect(0, 0, winW, winH);
				ctx.strokeStyle = `rgba(100,255,255,1)`;
				ctx.lineWidth = 1;
				ctx.beginPath();
				ctx.moveTo(f.ends[0], f.ends[1]);
				ctx.lineTo(f.ends[2], f.ends[3]);
				ctx.stroke();

				//算节框斜角phi， 以及将节框（和星）旋转-phi
				let phi = Math.acos((f.ends[2] - f.ends[0]) / f.dim[0]);
				let box = [
					(f.ends[0] - cX) * Math.cos(phi) + (f.ends[1] - cY) * Math.sin(phi),
					(f.ends[1] - cY) * Math.cos(phi) - (f.ends[0] - cX) * Math.sin(phi),
				]
				box = [
					box[0],
					box[1] - f.dim[1] / 2,
					box[0] + f.dim[0],
					box[1] + f.dim[1] / 2,
				]

				ctx.beginPath();
				ctx.moveTo(box[0] + cX, box[1] + cY);
				ctx.lineTo(box[2] + cX, box[1] + cY);
				ctx.lineTo(box[2] + cX, box[3] + cY);
				ctx.lineTo(box[0] + cX, box[3] + cY);
				ctx.stroke();

				//初筛筛掉半径不符合的星，上限取两x最大x和两y最大y的勾股长，下限一样取勾股长，但两x异号则最小x取0，两y一样
				let priCut = [
					Math.sqrt(
						(Math.sign(box[0]) * Math.sign(box[2]) > 0 ?
							Math.min(Math.abs(box[0]), Math.abs(box[2])) ** 2 : 0)
						+ (Math.sign(box[1]) * Math.sign(box[3]) > 0 ?
							Math.min(Math.abs(box[1]), Math.abs(box[3])) ** 2 : 0)
					),
					Math.sqrt(
						Math.max(Math.abs(box[0]), Math.abs(box[2])) ** 2
						+ Math.max(Math.abs(box[3]), Math.abs(box[3])) ** 2
					)
				]
				let priCut_i = [0, 0]
				while (stars[priCut_i[0]].r < priCut[0]) priCut_i[0]++;
				priCut_i[1] = priCut_i[0];
				while (stars[priCut_i[1]].r <= priCut[1]) priCut_i[1]++;

				let starR, intX, intY, p;
				for (let j = priCut_i[0]; j < priCut_i[1]; j++) {
					starR = stars[j].r;

					ctx.beginPath();
					ctx.moveTo(cX, cY);
					ctx.arc(cX, cY, starR, 0, 2 * Math.PI);
					ctx.stroke();

					//依据反正弦反余弦分别组装区间, 加入镜面端点
					intX = [
						!(box[2] > starR && box[0] < starR) - 0,
						Math.acos(box[2] / starR),
						Math.acos(box[0] / starR)]
						.filter(x => !isNaN(x));
					intX = intX.concat(intX.slice(1).reverse().map(x => 2 * Math.PI - x));

					intY = [
						!(box[1] < -starR && box[3] > -starR) - 0,
						Math.asin(box[1] / starR),
						Math.asin(box[3] / starR)]
						.filter(x => !isNaN(x));
					intY = intY.concat(intY.slice(1).reverse().map(x => Math.PI - x));

					//修正-pi/2~0，然后x和y区间求交集
					p = intY.findIndex((x, i) => i > 0 && x > 0);
					if (p == -1) p = intY.length;
					intY = intervalCalc(intX, intY.concat(
						intY.splice(0, p, (p - intY[0] + 1) % 2)
							.slice(1).map((x, i) => x + 2 * Math.PI)
					));
					if (intY.length != 1) {
						//减去星的theta0，加上phi
						intY = intY.map((x, i) => i ? x + phi - stars[j].theta : x);
						//下修正
						p = intY.findIndex((x, i) => i > 0 && x > 0);
						if (p == -1) p = intY.length;
						intY = intY.concat(
							intY.splice(0, p, (p - intY[0] + 1) % 2)
								.slice(1).map((x, i) => x + 2 * Math.PI)
						);
						//上修正
						p = intY.findIndex((x, i) => i > 0 && x > 2 * Math.PI);
						if (p == -1) p = intY.length;
						f.intOfStars.push({
							starIndex: j,
							interval: [intY[0]].concat(
								intY.splice(p, intY.length - p)
									.map((x, i) => x - 2 * Math.PI),
								intY.slice(1))
						}); //console.log(linei, framei, j)
					}
				}
			})
		})
	})
}

/*
intOfStars : [		//记录所有可能进入每个节框的星
{
	starIndex : i,	//星在星数组的索引
	interval : [],	//入框区间集
},...
],
starPicked : i			//阶段2计算量
*/

function pickOneStar(frame) {
	if (!pickOn) { return [-1] }

	/*
	let star = (arr =>
		arr.length == 0 ? { starIndex: -1 } :
			intOfStars[arr[Math.floor(Math.random() * arr.length)]]
	)(
		intOfStars.map((star, i) =>
			(star.interval.length - 1
				- star.interval.reverse().findIndex(x => x < theta % (2 * Math.PI))
				- star.interval[0] + 1) % 2 && i
		).filter(x => x != 0)
	);
	*/
	let nextEndOfInts = frame.intOfStars.map((star, i) => [i,
		(i => i == -1 ? star.interval[0] : i)(
			star.interval.findIndex((x, i) =>
				i > 0 && x > theta % (2 * Math.PI)
			)
		) - star.interval[0]
	]);
	let RHEnds = nextEndOfInts.filter(ele => ele[1] % 2 == 1);
	let res;
	if (!pickOn) { return [-1] }
	if (nextEndOfInts.length == 0) { return [] }
	if (RHEnds.length == 0) {
		frame.starPicked = -1;
		res = [
			Math.min.apply(null,
				nextEndOfInts.map(x =>
					(int => int[x[1] + int[0]])(frame.intOfStars[x[0]].interval)
				)
			) + theta,
			frame,
		];
		return res;
	} else {
		let picked = Math.floor(Math.random() * RHEnds.length);
		frame.starPicked = frame.intOfStars[RHEnds[picked][0]].starIndex;
		res = [
			(int => int[RHEnds[picked][1] + int[0]])
				(frame.intOfStars[RHEnds[picked][0]].interval),
			frame,
		];
		return res;
	}
}

//tasks : [[t1, frame], ...]
async function pickStar() {
	pickInt[0] = pickInt[1];
	pickInt[1] = theta;
	let nextTask;
	let subQueue = [];
	let nextQueue = [];
	if (!pickAll) {
		let pickI = [
			pickQueue.findIndex(x => x[0] > pickInt[0] % (2 * Math.PI)),
			pickQueue.findIndex(x => x[0] > pickInt[1] % (2 * Math.PI))
		].map(i => i == -1 ? pickQueue.length : i);
		if (pickInt[1] - pickInt[0] > 2 * Math.PI
			|| pickI[0] == pickI[1] && pickInt[1] - pickInt[0] > Math.PI) {
			pickAll = true;
		} else {
			if (pickI[0] > pickI[1]) {
				subQueue = pickQueue.splice(pickI[0], pickQueue.length - pickI[0])
					.concat(pickQueue.splice(0, pickI[1]));
			} else {
				subQueue = pickQueue.splice(pickI[0], pickI[1] - pickI[0]);
			}
		}
	}
	if (pickAll) {
		for (const line of flagNow.lines) {
			for (const frame of line.frames) {
				subQueue.push([0,frame]);
			}
		}
		pickQueue = [];
	}

	for (let task of subQueue) {
		nextTask = pickOneStar(task[1]);
		if (nextTask.length == 0) { continue; }
		if (nextTask.length == 1) { break; }
		nextQueue.push(nextTask);
	}

	if (pickOn) {
		pickQueue = pickQueue.concat(nextQueue).sort((a, b) => a[0] - b[0]);
		pickAll = false;
	} else {
		pickQueue = [];
		pickAll = true;
	}
	termPick = true;
	console.log("picked");
}

//Runtime
/*
加载线：
0: 无
1: svg读取完成
（窗口变化重置点）
2: 星定位 节框定位
3: 相交计算
重选星的时候不重置，不干扰绘制运行
*/
var availability = 0;
var loadOn = false;
var termLoad = true;
var pickOn = false;
var pickAll = true;
var termPick = true;
/*
	star 结构:
	star = {
		r : r0,
		theta : theta0, 	//初始坐标
		color : [r, g, b],
		size : r,
		alpha : a,	//0 - 1
		evalX : 1	//
		evalY : 1	//
	}
*/
async function draw() {
	canvasEle = window.document.getElementById("canvas");
	if (canvasEle.getContext) {
		ctx = canvasEle.getContext("2d");
	}
	else {
		console.log("ctx not found");
		return 0;
	}
	ctx.clearRect(0, 0, winW, winH);
	if (availability >= 2) {
		stars.forEach((star, i) => {
			star.evalX = cX + star.r * Math.cos(theta + star.theta);
			star.evalY = cY + star.r * Math.sin(theta + star.theta);
			ctx.fillStyle = `rgba(${star.color[0]}, ${star.color[1]}, ${star.color[2]}, ${star.alpha[0] * (1 - star.alpha[1] / 2 + star.alpha[1] / 2 * Math.cos(star.alpha[2] * theta + star.alpha[3]))
				})`;
			ctx.beginPath();
			ctx.moveTo(star.evalX, star.evalY);
			ctx.arc(star.evalX, star.evalY, star.size, 0, 2 * Math.PI);
			ctx.fill();
		});

		flagNow.lines.forEach((line, lineI) => {
			ctx.strokeStyle = `rgba(255,255,255,.3)`;
			ctx.lineWidth = 5;
			ctx.beginPath();
			ctx.moveTo(line.ends[0], line.ends[1]);
			ctx.lineTo(line.ends[2], line.ends[3]);
			ctx.stroke();

			ctx.strokeStyle = `rgba(255,100,255,1)`;
			ctx.lineWidth = 1;
			line.frames.forEach((frame, frameI) => {
				ctx.strokeStyle = frameI % 2 == 0 ? `rgba(255,100,255,1)` : `rgba(100,255,255,1)`;
				ctx.beginPath();
				ctx.moveTo(frame.ends[0], frame.ends[1]);
				ctx.lineTo(frame.ends[2], frame.ends[3]);
				ctx.stroke();
			});
		});

		if (availability >= 3) {
			ctx.lineWidth = 1;
			ctx.strokeStyle = `rgba(255,255,100,1)`;
			flagNow.lines.forEach((line, lineI) => {
				ctx.beginPath();
				line.frames.filter(f => f.starPicked != -1)
					.forEach((frame, frameI) => {
						let star = stars[frame.starPicked];
						if (frameI == 0) {
							ctx.moveTo(star.evalX, star.evalY);
						} else {
							ctx.lineTo(star.evalX, star.evalY);
						}
					});
				ctx.stroke();
			});
		}
	}
}



async function loadThread() {
	if (loadOn) {
		switch (availability) {
			case 0:
				await svgLoad();
				if (!loadOn) { termLoad = true; return; }
				if (flagNowAt == -1) { termLoad = true; return; }
				availability = 1;
			case 1:
				await starInit();
				if (!loadOn) { termLoad = true; return; }
				await updateCoord();
				if (!loadOn) { termLoad = true; return; }
				await frameInit();
				if (!loadOn) { termLoad = true; return; }
				availability = 2;
			case 2:
				await starEncounterCalc();
				if (!loadOn) { termLoad = true; return; }
				availability = 3;
				break;
		}
	}
	termLoad = true;
	return;
}

function anim() {
	//theta = (new Date() - timeBase) * omega;
	theta += omega * 40;
	if (!updateWinDims()) {
		document.getElementById("canvas").setAttribute("width", winW);
		document.getElementById("canvas").setAttribute("height", winH);
		availability = Math.min(availability, 1);
		loadOn = pickOn = false;
	}
	if (!loadOn && termLoad && !pickOn && termPick) {
		loadOn = true;
		termLoad = false;
		loadThread();
	}
	if (loadOn && termLoad && !pickOn) {
		pickOn = true;
	}
	if (availability == 3 && pickOn && termPick) {
		termPick = false;
		pickStar();
	}

	draw();
	window.requestAnimationFrame(anim);
}

anim();

async function test() {
	await svgLoad();
}

async function animTest() {
	updateWinDims();
	document.getElementById("canvas").setAttribute("width", winW);
	document.getElementById("canvas").setAttribute("height", winH);
	loadOn = true;
	termLoad = false;
	await loadThread();
}