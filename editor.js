import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

const stage = document.querySelector('#stage');
const status = document.querySelector('#status');
const rotate = document.querySelector('#rotate');
const remove = document.querySelector('#remove');
const catalog = [...document.querySelectorAll('[data-piece]')];
const preview = document.querySelector('#preview');
const result = document.querySelector('#result');
const viewer = document.querySelector('#viewer');
const download = document.querySelector('#download');
const arViewer = document.querySelector('#ar-viewer');
const arScale = document.querySelector('#ar-scale');
const launchAR = document.querySelector('#launch-ar');
let arUrl = null;
arViewer.addEventListener('load', () => {
    launchAR.disabled = !arViewer.canActivateAR;
    if (!arViewer.canActivateAR) status.textContent = '3Dプレビューを表示しています。ARを見るには、対応するスマートフォンとブラウザーが必要です。';
});
launchAR.addEventListener('click', () => {
    arViewer.activateAR().catch(error => {
        console.error(error);
        status.textContent = 'この端末ではARを起動できませんでした。';
    });
});
const scene = new THREE.Scene();
scene.background = new THREE.Color('#e5ebf1');
let renderer;
try {
    renderer = new THREE.WebGLRenderer({ antialias: true });
} catch (error) {
    status.textContent = 'このブラウザーではWebGLを起動できませんでした。';
    for (const button of [...catalog, preview]) button.disabled = true;
    throw error;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
stage.append(renderer.domElement);

const camera = new THREE.OrthographicCamera();
camera.position.set(6, 8, 10);
camera.lookAt(0, 0, 0);
scene.add(new THREE.HemisphereLight(0xffffff, 0x9a8d7a, 2.4));
const light = new THREE.DirectionalLight(0xffffff, 2);
light.position.set(3, 8, 6);
scene.add(light);
function box(parent, width, height, depth, x, y, z, color) {
    const material = typeof color === 'string' ? new THREE.MeshStandardMaterial({ color, roughness: 0.8 }) : color;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
    mesh.position.set(x, y, z);
    parent.add(mesh);
}

function createFloor(name, floorColor, wallColor) {
    const room = new THREE.Group();
    room.name = name;
    const pieces = new THREE.Group();
    const wall = new THREE.MeshStandardMaterial({ color: wallColor, roughness: 0.85 });
    room.add(pieces);
    const surface = new THREE.Mesh(
        new THREE.PlaneGeometry(6, 5),
        new THREE.MeshStandardMaterial({ color: floorColor, roughness: 0.8 })
    );
    surface.name = 'Piso';
    surface.rotation.x = -Math.PI / 2;
    room.add(surface);
    box(room, 6, 2.35, .12, 0, 1.175, -2.56, wall);
    box(room, .12, 2.35, 5, -3.06, 1.175, 0, wall);
    return { room, pieces, wall };
}

const floors = [
    createFloor('1階', '#d2af86', '#e8ded0'),
    createFloor('2階', '#b89b80', '#e1e8ec')
];
const floorSelect = document.querySelector('#floor-select');
let activeFloor = floors[Number(floorSelect.value)];
scene.add(activeFloor.room);

const grid = new THREE.GridHelper(6, 12, 0x8c755e, 0xbaa58d);
grid.position.y = .002;
grid.scale.z = 5 / 6;
scene.add(grid);

const furniture = {
    sofa: { name: 'ソファ', width: 2, depth: .9 },
    table: { name: 'テーブル', width: 1.3, depth: .8 },
    chair: { name: '椅子', width: .55, depth: .55 }
};
function makePiece(type) {
    const piece = new THREE.Group();
    piece.userData.type = type;
    if (type === 'sofa') {
        box(piece, 2, .34, .9, 0, .25, 0, '#476d65');
        box(piece, 2, .5, .18, 0, .58, -.36, '#476d65');
        for (const side of [-1, 1]) {
            box(piece, .17, .33, .9, side * .91, .48, 0, '#385950');
            box(piece, .79, .12, .68, side * .41, .45, .07, '#719184');
        }
    } else {
        const table = type === 'table';
        const { width, depth } = furniture[type];
        const height = table ? .75 : .46;
        const wood = table ? '#835b40' : '#304f75';
        box(piece, width, .08, depth, 0, height, 0, wood);
        for (const x of [-1, 1]) {
            for (const z of [-1, 1]) {
                box(piece, .07, height, .07, x * (width / 2 - .06), height / 2, z * (depth / 2 - .06), wood);
            }
        }
        if (!table) box(piece, .55, .43, .08, 0, .68, -.235, wood);
    }
    return piece;
}

const ray = new THREE.Raycaster();
const floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const pointer = new THREE.Vector2();
let armed = null;
let selected = null;
let gesture = null;
let modelUrl = null;
const selection = new THREE.BoxHelper(new THREE.Object3D(), 0x245e9b);
selection.visible = false;
scene.add(selection);

function draw() {
    selection.visible = !!selected;
    if (selected) selection.setFromObject(selected);
    renderer.render(scene, camera);
}
function resize() {
    const { clientWidth: width, clientHeight: height } = stage;
    if (!width || !height) return;
    const aspect = width / height;
    const half = Math.max(3.75, 4.3 / aspect);
    camera.left = -half * aspect;
    camera.right = half * aspect;
    camera.top = half;
    camera.bottom = -half;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
    draw();
}
new ResizeObserver(resize).observe(stage);

function updateControls(message) {
    status.textContent = message;
    rotate.disabled = remove.disabled = !selected || !result.hidden;
    for (const button of catalog) button.setAttribute('aria-pressed', String(button.dataset.piece === armed));
    draw();
}
function pointAt(event) {
    const bounds = stage.getBoundingClientRect();
    pointer.set((event.clientX - bounds.left) / bounds.width * 2 - 1, 1 - (event.clientY - bounds.top) / bounds.height * 2);
    ray.setFromCamera(pointer, camera);
    return ray.ray.intersectPlane(floor, new THREE.Vector3());
}
function onFloor(point) {
    return point && Math.abs(point.x) <= 3 && Math.abs(point.z) <= 2.5;
}
function position(piece, point) {
    const { width, depth } = furniture[piece.userData.type];
    const c = Math.abs(Math.cos(piece.rotation.y));
    const s = Math.abs(Math.sin(piece.rotation.y));
    const x = (c * width + s * depth) / 2;
    const z = (s * width + c * depth) / 2;
    piece.position.set(THREE.MathUtils.clamp(point.x, -3 + x, 3 - x), 0, THREE.MathUtils.clamp(point.z, -2.5 + z, 2.5 - z));
}
function addPiece(type, point) {
    selected = makePiece(type);
    activeFloor.pieces.add(selected);
    position(selected, point);
    armed = null;
    updateControls(furniture[type].name + 'を配置しました。ドラッグして位置を調整できます。');
}
for (const button of catalog) {
    const type = button.dataset.piece;
    let moved = false;
    button.addEventListener('pointerdown', event => {
        if (event.button !== 0 || !result.hidden || gesture) return;
        moved = false;
        button.setPointerCapture(event.pointerId);
        gesture = { id: event.pointerId, type, x: event.clientX, y: event.clientY, draft: null };
    });
    button.addEventListener('pointermove', event => {
        if (gesture?.id !== event.pointerId) return;
        if (!moved && Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) < 6) return;
        moved = true;
        const point = pointAt(event);
        if (onFloor(point)) {
            if (!gesture.draft) {
                gesture.draft = makePiece(type);
                activeFloor.pieces.add(gesture.draft);
            }
            gesture.draft.visible = true;
            position(gesture.draft, point);
        } else if (gesture.draft) gesture.draft.visible = false;
        draw();
    });
    button.addEventListener('pointerup', event => {
        if (gesture?.id !== event.pointerId) return;
        const draft = gesture.draft;
        gesture = null;
        if (draft) activeFloor.pieces.remove(draft);
        const point = pointAt(event);
        if (moved && onFloor(point)) addPiece(type, point);
        else draw();
    });
    button.addEventListener('pointercancel', () => {
        if (gesture?.draft) activeFloor.pieces.remove(gesture.draft);
        gesture = null;
        draw();
    });
    button.addEventListener('click', event => {
        if (!result.hidden || (event.detail && moved)) return;
        armed = type;
        selected = null;
        updateControls(furniture[type].name + 'を置きたい場所をタップしてください。');
    });
}

const canvas = renderer.domElement;
let drag = null;
canvas.addEventListener('pointerdown', event => {
    if (event.button !== 0 || drag) return;
    const point = pointAt(event);
    if (!point) return;
    if (armed && onFloor(point)) {
        addPiece(armed, point);
        return;
    }
    const hit = ray.intersectObjects(activeFloor.pieces.children, true)[0];
    selected = hit?.object.parent ?? null;
    if (selected) {
        drag = { id: event.pointerId, offset: selected.position.clone().sub(point) };
        canvas.setPointerCapture(event.pointerId);
    }
    updateControls(selected ? furniture[selected.userData.type].name + 'を選択しました。' : '配置する家具を選んでください。');
});
canvas.addEventListener('pointermove', event => {
    if (drag?.id !== event.pointerId || !selected) return;
    const point = pointAt(event);
    if (point) position(selected, point.add(drag.offset));
    draw();
});
for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    canvas.addEventListener(name, event => {
        if (drag?.id === event.pointerId) drag = null;
    });
}
rotate.addEventListener('click', () => {
    if (!selected) return;
    selected.rotation.y += Math.PI / 4;
    position(selected, selected.position);
    draw();
});
remove.addEventListener('click', () => {
    if (!selected) return;
    activeFloor.pieces.remove(selected);
    selected = null;
    updateControls('家具を削除しました。');
});
const wallColor = document.querySelector('#wall-color');
wallColor.value = '#' + activeFloor.wall.color.getHexString();
floorSelect.addEventListener('change', () => {
    if (gesture?.draft) activeFloor.pieces.remove(gesture.draft);
    gesture = null;
    drag = null;
    selected = null;
    armed = null;
    scene.remove(activeFloor.room);
    activeFloor = floors[Number(floorSelect.value)];
    scene.add(activeFloor.room);
    wallColor.value = '#' + activeFloor.wall.color.getHexString();
    updateControls(activeFloor.room.name + 'を選択しました。');
});
wallColor.addEventListener('input', event => {
    activeFloor.wall.color.set(event.target.value);
    draw();
});

preview.addEventListener('click', async () => {
    if (gesture || drag) return;
    const editingControls = [...catalog, wallColor, arScale, floorSelect, rotate, remove, preview];
    for (const control of editingControls) control.disabled = true;
    try {
        const exporter = new GLTFExporter();
        const buffer = await exporter.parseAsync(activeFloor.room, { binary: true });
        const percent = Number.parseInt(arScale.value, 10);
        const scale = percent === 100 ? 1 : percent / 200;
        const arRoom = activeFloor.room.clone();
        arRoom.scale.setScalar(scale);
        const arBuffer = scale === 1 ? buffer : await exporter.parseAsync(arRoom, { binary: true });
        if (arUrl) URL.revokeObjectURL(arUrl);
        arUrl = URL.createObjectURL(new Blob([arBuffer], { type: 'model/gltf-binary' }));
        launchAR.disabled = true;
        arViewer.src = arUrl;
        if (modelUrl) URL.revokeObjectURL(modelUrl);
        modelUrl = URL.createObjectURL(new Blob([buffer], { type: 'model/gltf-binary' }));
        viewer.src = modelUrl;
        download.href = modelUrl;
        stage.hidden = true;
        result.hidden = false;
        status.textContent = activeFloor.room.name + 'の配置を確認できます。ARでは、この階の床が実際の床と同じ高さになります。';
    } catch (error) {
        console.error(error);
        for (const control of [...catalog, wallColor, arScale, floorSelect, preview]) control.disabled = false;
        updateControls('プレビューを作成できませんでした。');
    }
});
document.querySelector('#back').addEventListener('click', () => {
    result.hidden = true;
    stage.hidden = false;
    for (const control of [...catalog, wallColor, arScale, floorSelect, preview]) control.disabled = false;
    updateControls('編集に戻りました。');
});
