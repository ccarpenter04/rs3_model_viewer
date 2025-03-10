import { parse } from "../opdecoder";
import { appearanceUrl, avatarStringToBytes, avatarToModel } from "./avatar";
import * as THREE from "three";
import { ThreejsSceneCache, mergeModelDatas, ob3ModelToThree, mergeNaiveBoneids, constModelsIds } from '../3d/modeltothree';
import { ModelModifications, constrainedMap, TypedEmitter, CallbackPromise } from '../utils';
import { boundMethod } from 'autobind-decorator';
import { resolveMorphedObject, modifyMesh, MapRect, ParsemapOpts, parseMapsquare, mapsquareToThreeSingle, ChunkData, TileGrid, mapsquareSkybox, generateLocationMeshgroups, PlacedMesh, classicChunkSize, rs2ChunkSize, tiledimensions, ModelExtras, mapsquareFloors, mapsquareObjectModels, mapsquareOverlays, PlacedModel } from '../3d/mapsquare';
import { AnimationClip, AnimationMixer, Group, Material, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, Skeleton, SkeletonHelper, SkinnedMesh, Texture, Vector2 } from "three";
import { mountBakedSkeleton, parseAnimationSequence4 } from "../3d/animationframes";
import { cacheConfigPages, cacheMajors, lastClassicBuildnr } from "../constants";
import { ModelData } from "../3d/rt7model";
import { mountSkeletalSkeleton, parseSkeletalAnimation } from "../3d/animationskeletal";
import { jsonIcons, svgfloor } from "../map/svgrender";
import { ThreeJsRenderer, ThreeJsSceneElement, ThreeJsSceneElementSource } from "../viewer/threejsrender";
import { animgroupconfigs } from "../../generated/animgroupconfigs";
import fetch from "node-fetch";
import { MaterialData } from "./jmat";
import { legacyMajors } from "../cache/legacycache";
import { classicGroups } from "../cache/classicloader";


export type SimpleModelDef = {
	modelid: number,
	mods: ModelModifications
}[];

export type SimpleModelInfo<T = object, ID = string> = {
	models: SimpleModelDef,
	anims: Record<string, number>,
	info: T,
	id: ID,
	name: string
}

//typescript helper to force type inference
export function castModelInfo<T, ID>(info: SimpleModelInfo<T, ID>) {
	return info;
}

export async function modelToModel(cache: ThreejsSceneCache, id: number) {
	let modeldata = await cache.getModelData(id);
	//getting the same file a 2nd time to get the full json
	let info: any;
	if (cache.modelType == "classic") {
		let arch = await cache.engine.getArchiveById(0, classicGroups.models);
		info = parse.classicmodels.read(arch[id].buffer, cache.engine.rawsource);
	} else if (cache.modelType == "old") {
		let major = (cache.engine.legacyData ? legacyMajors.oldmodels : cacheMajors.oldmodels);
		info = parse.oldmodels.read(await cache.engine.getFileById(major, id), cache.engine.rawsource);
	} else if (cache.modelType == "nxt") {
		info = parse.models.read(await cache.engine.getFileById(cacheMajors.models, id), cache.engine.rawsource);
	}
	return castModelInfo({
		models: [{ modelid: id, mods: {} }],
		anims: {},
		info: { modeldata, info },
		id,
		name: `model:${id}`
	});
}

export async function playerDataToModel(cache: ThreejsSceneCache, modeldata: { player: string, head: boolean, data: Buffer }) {
	let avainfo = await avatarToModel(cache.engine, modeldata.data, modeldata.head);
	return castModelInfo({
		...avainfo,
		id: modeldata,
		name: modeldata.player
	});
}

export async function playerToModel(cache: ThreejsSceneCache, name: string) {
	let url = appearanceUrl(name);
	let data = await fetch(url).then(q => q.text());
	if (data.indexOf("404 - Page not found") != -1) { throw new Error("player avatar not found"); }
	let avainfo = await avatarToModel(cache.engine, avatarStringToBytes(data), false);
	return castModelInfo({
		...avainfo,
		id: name,
		name: name
	});
}

export async function npcBodyToModel(cache: ThreejsSceneCache, id: number) {
	return npcToModel(cache, { id, head: false });
}

export async function npcToModel(cache: ThreejsSceneCache, id: { id: number, head: boolean }) {
	let npc = parse.npc.read(await cache.engine.getGameFile("npcs", id.id), cache.engine.rawsource);
	let anims: Record<string, number> = {};
	let modelids = (id.head ? npc.headModels : npc.models) ?? [];
	if (!id.head && npc.animation_group) {
		let arch = await cache.engine.getArchiveById(cacheMajors.config, cacheConfigPages.animgroups);
		let animgroup = parse.animgroupConfigs.read(arch[npc.animation_group].buffer, cache.engine.rawsource);
		anims = serializeAnimset(animgroup);
	}
	let mods: ModelModifications = {};
	if (npc.color_replacements) { mods.replaceColors = npc.color_replacements; }
	if (npc.material_replacements) { mods.replaceMaterials = npc.material_replacements; }
	let models = modelids.map(q => ({ modelid: q, mods }));
	return castModelInfo({
		info: npc,
		models,
		anims,
		id,
		name: npc.name ?? `npc:${id.id}`
	});
}

export async function spotAnimToModel(cache: ThreejsSceneCache, id: number) {
	let animdata = parse.spotAnims.read(await cache.engine.getGameFile("spotanims", id), cache.engine.rawsource);
	let mods: ModelModifications = {};
	if (animdata.replace_colors) { mods.replaceColors = animdata.replace_colors; }
	if (animdata.replace_materials) { mods.replaceMaterials = animdata.replace_materials; }
	let models = (animdata.model ? [{ modelid: animdata.model, mods }] : []);
	let anims: Record<string, number> = {};
	if (animdata.sequence) { anims.default = animdata.sequence; }
	return castModelInfo({
		models,
		anims,
		info: animdata,
		id,
		name: `spotanim:${id}`
	});
}

export async function locToModel(cache: ThreejsSceneCache, id: number) {
	let { morphedloc } = await resolveMorphedObject(cache.engine, id);
	let mods: ModelModifications = {};
	let anims: Record<string, number> = {};
	let models: SimpleModelDef = [];
	if (morphedloc) {
		if (morphedloc.color_replacements) { mods.replaceColors = morphedloc.color_replacements; }
		if (morphedloc.material_replacements) { mods.replaceMaterials = morphedloc.material_replacements; }
		if (cache.engine.getBuildNr() > lastClassicBuildnr && cache.engine.getBuildNr() < 377) {
			//old caches just use one prop to replace both somehow
			mods.replaceMaterials = mods.replaceColors;
		}
		models = [
			...morphedloc.models?.flatMap(m => m.values).map(q => ({ modelid: q, mods })) ?? [],
			...morphedloc.models_05?.models.flatMap(m => m.values).map(q => ({ modelid: q, mods })) ?? []
		];
	}
	if (morphedloc?.probably_animation) {
		anims.default = morphedloc.probably_animation;
	}
	return castModelInfo({
		models,
		anims,
		info: morphedloc,
		id,
		name: morphedloc.name ?? `loc:${id}`
	});
}
export async function itemToModel(cache: ThreejsSceneCache, id: number) {
	let item = parse.item.read(await cache.engine.getGameFile("items", id), cache.engine.rawsource);
	if (!item.baseModel && item.noteTemplate) {
		item = parse.item.read(await cache.engine.getGameFile("items", item.noteTemplate), cache.engine.rawsource);
	}
	let mods: ModelModifications = {};
	if (item.color_replacements) { mods.replaceColors = item.color_replacements; }
	if (item.material_replacements) { mods.replaceMaterials = item.material_replacements; }
	let models = (item.baseModel ? [{ modelid: item.baseModel, mods }] : [])

	return castModelInfo({
		models,
		anims: {},
		info: item,
		id,
		name: item.name ?? `item:${id}`
	});
}

export async function materialToModel(sceneCache: ThreejsSceneCache, id: number) {
	let assetid = constModelsIds.materialCube;
	let mods: ModelModifications = {
		replaceMaterials: [[0, id]]
	};
	let mat = sceneCache.engine.getMaterialData(id);
	let texs: Record<string, { texid: number, filesize: number, img0: HTMLImageElement | HTMLCanvasElement | HTMLVideoElement | ImageBitmap }> = {};
	let addtex = async (type: keyof MaterialData["textures"], name: string, texid: number) => {
		let tex = await sceneCache.getTextureFile(type, texid, mat.stripDiffuseAlpha && name == "diffuse");
		let drawable = await tex.toWebgl();

		texs[name] = { texid, filesize: tex.filesize, img0: drawable };
	}
	for (let tex in mat.textures) {
		if (mat.textures[tex] != 0) {
			await addtex(tex as keyof MaterialData["textures"], tex, mat.textures[tex]);
		}
	}
	return castModelInfo({
		models: [{ modelid: assetid, mods }],
		anims: {},
		info: { texs, obj: mat },
		id: id,
		name: `material:${id}`
	});
}

export class RSModel extends TypedEmitter<{ loaded: undefined, animchanged: number }> implements ThreeJsSceneElementSource {
	model: Promise<{ modeldata: ModelData, mesh: Object3D, nullAnim: AnimationClip }>;
	loaded: { modeldata: ModelData, mesh: Object3D, nullAnim: AnimationClip, matUvAnims: { tex: Texture, v: Vector2 }[] } | null = null;
	cache!: ThreejsSceneCache;
	rootnode = new THREE.Group();
	nullAnimPromise = { clip: null as AnimationClip | null, prom: new CallbackPromise<AnimationClip>() };
	anims: Record<number, { clip: AnimationClip | null, prom: Promise<AnimationClip> }> = {
		"-1": this.nullAnimPromise
	};
	mountedanim: AnimationClip | null = null;
	mixer = new AnimationMixer(this.rootnode);
	renderscene: ThreeJsRenderer | null = null;
	targetAnimId = -1;
	skeletontype: "none" | "baked" | "full" = "none";
	skeletonHelper: SkeletonHelper | null = null;

	cleanup() {
		this.listeners = {};
		this.renderscene?.removeSceneElement(this);
		this.skeletonHelper?.removeFromParent();
		this.renderscene = null;
	}

	getSceneElements(): ThreeJsSceneElement {
		return {
			modelnode: this.rootnode,
			updateAnimation: this.updateAnimation
		}
	}

	addToScene(scene: ThreeJsRenderer) {
		this.renderscene = scene;
		scene.addSceneElement(this);
	}

	onModelLoaded() {
		this.emit("loaded", undefined);
		this.renderscene?.forceFrame();
		this.renderscene?.setCameraLimits();
	}

	@boundMethod
	updateAnimation(delta: number, epochtime: number) {
		this.mixer.update(delta);
		this.loaded?.matUvAnims.forEach(q => q.tex.offset.copy(q.v).multiplyScalar(epochtime));
	}

	constructor(cache: ThreejsSceneCache, models: SimpleModelDef, name = "") {
		super();
		this.cache = cache;
		this.model = (async () => {
			let meshdatas = await Promise.all(models.map(async modelinit => {
				let meshdata = await cache.getModelData(modelinit.modelid);
				let modified = {
					...meshdata,
					meshes: meshdata.meshes.map(q => modifyMesh(q, modelinit.mods))
				};
				return modified;
			}));
			let modeldata = mergeModelDatas(meshdatas);
			mergeNaiveBoneids(modeldata);
			let mesh = await ob3ModelToThree(this.cache, modeldata);
			mesh.name = name;

			let nullbones: Object3D[] = [];
			for (let i = 0; i < Math.max(modeldata.bonecount, modeldata.skincount); i++) { nullbones.push(mesh); }
			let nullskel = new Skeleton(nullbones as any);
			let matUvAnims: { tex: Texture, v: Vector2 }[] = [];
			mesh.traverse(node => {
				if (node instanceof SkinnedMesh) {
					node.bind(nullskel);
				}
				if (node instanceof Mesh && node.material instanceof Material) {
					let uvExt = node.material.userData.gltfExtensions?.RA_materials_uvanim;
					if (uvExt) {
						let mat = (node.material as MeshStandardMaterial);
						let animvec = new Vector2(uvExt.uvAnim[0], uvExt.uvAnim[1]);
						if (mat.map) { matUvAnims.push({ tex: mat.map, v: animvec }); }
						if (mat.normalMap) { matUvAnims.push({ tex: mat.normalMap, v: animvec }); }
						if (mat.emissiveMap) { matUvAnims.push({ tex: mat.emissiveMap, v: animvec }); }
						if (mat.metalnessMap) { matUvAnims.push({ tex: mat.metalnessMap, v: animvec }); }
						if (mat.roughnessMap) { matUvAnims.push({ tex: mat.roughnessMap, v: animvec }); }
					}
				}
			});
			let nullAnim = new AnimationClip(undefined, undefined, []);
			this.nullAnimPromise.clip = nullAnim;
			this.nullAnimPromise.prom.done(nullAnim);

			this.rootnode.add(mesh);
			this.loaded = { mesh, modeldata, nullAnim, matUvAnims };
			if (this.targetAnimId == -1) { this.setAnimation(-1); }
			this.onModelLoaded();
			return this.loaded;
		})();
	}

	private mountAnim(clip: AnimationClip) {
		if (!this.loaded) { throw new Error("attempting to mount anim before model is loaded"); }
		if (this.mountedanim == clip) { return; }
		//TODO is this required?
		if (this.loaded.modeldata.bonecount == 0 && this.loaded.modeldata.skincount == 0) { return; }

		let mesh = this.loaded.mesh;
		if (mesh.animations.indexOf(clip) == -1) { mesh.animations.push(clip); }
		this.mixer.stopAllAction();
		let action = this.mixer.clipAction(clip, mesh);
		action.play();
		this.skeletonHelper?.removeFromParent();
		this.skeletonHelper = new SkeletonHelper(mesh);
		globalThis.skeletonhelper = this.skeletonHelper;
		// (this.renderscene as any)?.scene.add(this.skeletonHelper);
		this.mountedanim = clip;
	}

	loadAnimation(animid: number) {
		if (this.anims[animid]) { return this.anims[animid]; }
		this.anims[animid] = {
			clip: null,
			prom: (async () => {
				let seqfile = await this.cache.engine.getFileById(cacheMajors.sequences, animid);

				let seq = parse.sequences.read(seqfile, this.cache.engine.rawsource);

				let clip: AnimationClip;
				if (seq.skeletal_animation) {
					let anim = await parseSkeletalAnimation(this.cache, seq.skeletal_animation);
					clip = anim.clip;
					let loaded = this.loaded ?? await this.model;
					if (this.skeletontype != "full") {
						if (this.skeletontype != "none") { throw new Error("wrong skeleton type already mounted to model"); }
						await mountSkeletalSkeleton(loaded.mesh, this.cache, anim.framebaseid);
						this.skeletontype = "full";
					}
				} else if (seq.frames) {
					let frameanim = await parseAnimationSequence4(this.cache, seq.frames);
					let loaded = this.loaded ?? await this.model;
					if (this.skeletontype != "baked") {
						if (this.skeletontype != "none") { throw new Error("wrong skeleton type already mounted to model"); }
						mountBakedSkeleton(loaded.mesh, loaded.modeldata);
						this.skeletontype = "baked";
					}
					clip = frameanim(loaded.modeldata);
				} else {
					throw new Error("animation has no frames");
				}
				this.anims[animid] = { clip, prom: Promise.resolve(clip) };

				if (!this.loaded?.modeldata) { await this.model; }
				this.anims[animid].clip = clip;
				return clip;
			})()
		}
		return this.anims[animid];
	}

	async setAnimation(animid: number) {
		this.targetAnimId = animid;
		const mount = this.loadAnimation(animid);
		return this.mountAnim(mount.clip ?? await mount.prom);
	}
}


export type RSMapChunkData = {
	grid: TileGrid,
	chunks: ChunkData[],
	chunkSize: number,
	groups: Set<string>,
	sky: { skybox: Object3D, fogColor: number[], skyboxModelid: number } | null,
	modeldata: PlacedMesh[][],
	chunkmodels: Group[],
	rect: MapRect
}

export class RSMapChunk extends TypedEmitter<{ loaded: RSMapChunkData, changed: undefined }> implements ThreeJsSceneElementSource {
	chunkdata: Promise<RSMapChunkData>;
	loaded: RSMapChunkData | null = null;
	cache: ThreejsSceneCache;
	rootnode = new THREE.Group();
	mixer = new AnimationMixer(this.rootnode);
	renderscene: ThreeJsRenderer | null = null;
	toggles: Record<string, boolean> = {};
	rect: MapRect;

	cleanup() {
		this.listeners = {};

		//only clear vertex memory for now, materials might be reused and are up to the scenecache
		this.chunkdata.then(q => q.chunkmodels.forEach(node => {
			node.traverse(obj => {
				if (obj instanceof Mesh) { obj.geometry.dispose(); }
			});
		}))
		this.renderscene?.removeSceneElement(this);
		this.renderscene = null;
	}

	async renderSvg(level = 0, wallsonly = false, pxpersquare = 1) {
		let { chunks, grid, chunkSize } = await this.chunkdata;
		let rect: MapRect = { x: this.rect.x * chunkSize, z: this.rect.z * chunkSize, xsize: this.rect.xsize * chunkSize, zsize: this.rect.zsize * chunkSize };
		return svgfloor(this.cache.engine, grid, chunks.flatMap(q => q.locs), rect, level, pxpersquare, wallsonly, false);
	}

	getSceneElements(): ThreeJsSceneElement {
		return {
			modelnode: this.rootnode,
			sky: this.loaded?.sky,
			options: { hideFloor: true }
		};
	}

	addToScene(scene: ThreeJsRenderer) {
		this.renderscene = scene;
		scene.addSceneElement(this);
	}

	onModelLoaded() {
		this.setToggles(this.toggles);
		this.emit("loaded", this.loaded!);
		this.emit("changed", undefined);
		this.renderscene?.sceneElementsChanged();
		// this.renderscene?.setCameraLimits();//TODO fix this, current bounding box calc is too large
	}

	setToggles(toggles: Record<string, boolean>, hideall = false) {
		this.toggles = toggles;
		this.rootnode.traverse(node => {
			if (node.userData.modelgroup) {
				let newvis = (hideall ? false : toggles[node.userData.modelgroup] ?? true);
				node.traverse(child => {
					if (child instanceof THREE.Mesh) {
						child.visible = newvis;
					}
				});
			}
		});
	}

	constructor(rect: MapRect, cache: ThreejsSceneCache, extraopts?: ParsemapOpts) {
		super();
		this.rect = rect;
		this.cache = cache;
		this.chunkdata = (async () => {
			let opts: ParsemapOpts = { invisibleLayers: true, collision: true, map2d: false, padfloor: true, skybox: false, minimap: false, ...extraopts };
			let { grid, chunks } = await parseMapsquare(cache.engine, rect, opts);
			let processedChunks = await Promise.all(chunks.map(async chunkdata => {
				let floors = await mapsquareFloors(cache, grid, chunkdata, opts);
				let overlays = (!opts?.map2d ? [] : await mapsquareOverlays(cache.engine, grid, chunkdata.locs));
				let models = mapsquareObjectModels(cache.engine, chunkdata.locs);
				let locmeshes = await generateLocationMeshgroups(cache, models);
				let allmeshes = [...locmeshes.byMaterial, ...overlays];
				if (opts.minimap) {
					let minimodels = mapsquareObjectModels(cache.engine, chunkdata.locs, true);
					let minimeshes = await generateLocationMeshgroups(cache, minimodels, true);
					allmeshes.push(...minimeshes.byMaterial);
				}
				let group = await mapsquareToThreeSingle(this.cache, grid, chunkdata, floors, allmeshes);
				return { locmeshes, group };
			}));
			let sky = (extraopts?.skybox ? await mapsquareSkybox(cache, chunks[0]) : null);

			let chunkSize = (cache.engine.classicData ? classicChunkSize : rs2ChunkSize);
			if (processedChunks.length != 0) {
				this.rootnode.add(...processedChunks.map(q => q.group));
			}

			let groups = new Set<string>();
			this.rootnode.traverse(node => {
				if (node.userData.modelgroup) {
					groups.add(node.userData.modelgroup);
				}
				if (node instanceof THREE.Mesh) {
					let parent: THREE.Object3D | null = node;
					let iswireframe = false;
					//TODO this data should be on the mesh it concerns instead of a parent
					while (parent) {
						if (parent.userData.modeltype == "floorhidden") {
							iswireframe = true;
						}
						parent = parent.parent;
					}
					if (iswireframe && node.material instanceof THREE.MeshPhongMaterial) {
						node.material.wireframe = true;
					}
				}
			});

			//TODO remove
			globalThis.chunk = this;

			let modeldata = processedChunks.flatMap(q => q.locmeshes.byLogical);
			let chunkmodels = processedChunks.map(q => q.group);
			this.loaded = { grid, chunks, groups, sky, modeldata, chunkmodels, chunkSize, rect };
			this.onModelLoaded();
			return this.loaded;
		})();
	}
}

export function serializeAnimset(group: animgroupconfigs) {
	let anims: Record<string, number> = {};
	let addanim = (name: string, id: number) => {
		if (id != -1 && Object.values(anims).indexOf(id) == -1) {
			anims[name] = id;
		}
	}
	anims.none = -1;
	if (group.baseAnims) {
		addanim("default", group.baseAnims.idle);
		addanim("walk", group.baseAnims.walk);
	}
	if (group.run) {
		addanim("run", group.run);
	}
	if (group.idleVariations) {
		let totalchance = group.idleVariations.reduce((a, v) => a + v.probably_chance, 0);
		for (let [i, variation] of group.idleVariations.entries()) {
			addanim(i == 0 ? "default" : `idle${i}_${variation.probably_chance}/${totalchance}`, variation.animid);
		}
	}
	//TODO yikes, this object is not a map
	for (let [key, val] of Object.entries(group)) {
		if (typeof val == "number") {
			addanim(key, group[key]);
		}
	}

	return anims;
}